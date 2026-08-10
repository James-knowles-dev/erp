import crypto from "node:crypto";
import db from "../db.server";
import type { FieldMapping } from "../adapters/types";

// Milestone 8 (product spec §7.8): agency-side persistence helpers, mirroring the shape of
// connections.server.ts but for the Agency/AgencyClientLink/MappingTemplate tables rather than
// ErpConnection. Kept separate from connections.server.ts because these queries are reached from
// agency-session routes (app/routes/agency.*), not Shopify-session merchant routes.

const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I -- avoids transcription errors when a merchant reads the code aloud or types it

function randomInviteCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += INVITE_CODE_ALPHABET[crypto.randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

// Plaintext, unlike the API key (apiKey.server.ts hashes at rest) -- this is a single-use,
// merchant-displayed code meant to be read and typed once, not a long-lived bearer credential.
export async function generateInviteCode(shopId: string): Promise<string> {
  const code = randomInviteCode();
  await db.shop.update({
    where: { id: shopId },
    data: { agencyInviteCode: code, agencyInviteCodeUsedAt: null },
  });
  return code;
}

export async function getClientShop(shopId: string) {
  return db.shop.findUnique({
    where: { id: shopId },
    include: {
      erpConnections: { where: { status: { not: "disabled" } }, orderBy: { connectedAt: "desc" }, take: 1 },
    },
  });
}

export async function getAgencyLinkForShop(shopId: string) {
  return db.agencyClientLink.findFirst({
    where: { shopId },
    include: { agency: true },
  });
}

export async function redeemInviteCode(agencyId: string, code: string) {
  const shop = await db.shop.findUnique({ where: { agencyInviteCode: code.trim().toUpperCase() } });
  if (!shop) throw new Error("Invalid invite code.");
  if (shop.agencyInviteCodeUsedAt) throw new Error("This invite code has already been used.");

  const existingLink = await db.agencyClientLink.findFirst({ where: { shopId: shop.id } });
  if (existingLink) throw new Error("This shop is already linked to an agency.");

  const [, link] = await db.$transaction([
    db.shop.update({ where: { id: shop.id }, data: { agencyInviteCodeUsedAt: new Date() } }),
    db.agencyClientLink.create({ data: { agencyId, shopId: shop.id, role: "admin" } }),
  ]);
  return link;
}

export async function removeClientLink(agencyId: string, linkId: string) {
  const link = await db.agencyClientLink.findUnique({ where: { id: linkId } });
  if (!link || link.agencyId !== agencyId) {
    throw new Response("Client link not found.", { status: 404 });
  }
  // Deleting the link doesn't touch the shop's own connection/sync history -- it only removes the
  // agency's access, same as merchant-side Disconnect (app.settings.tsx) leaves sync history intact.
  await db.agencyUserClientAccess.deleteMany({ where: { agencyClientLinkId: linkId } });
  await db.agencyClientLink.delete({ where: { id: linkId } });
}

export async function listClientsForAgency(agencyId: string) {
  const links = await db.agencyClientLink.findMany({
    where: { agencyId },
    include: {
      shop: {
        include: {
          erpConnections: {
            where: { status: { not: "disabled" } },
            orderBy: { connectedAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  return links.map((link) => {
    const connection = link.shop.erpConnections[0] ?? null;
    return {
      linkId: link.id,
      role: link.role,
      shopId: link.shop.id,
      shopDomain: link.shop.shopifyDomain,
      connection: connection
        ? {
            id: connection.id,
            erpType: connection.erpType,
            environment: connection.environment,
            status: connection.status,
            live: Boolean(connection.wentLiveAt),
            shadowing: Boolean(connection.shadowModeStartedAt) && !connection.wentLiveAt,
            lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt,
          }
        : null,
    };
  });
}

export async function createMappingTemplate(
  agencyId: string,
  erpType: string,
  template: FieldMapping[],
  createdFromConnectionId?: string,
) {
  return db.mappingTemplate.create({
    data: { agencyId, erpType, template: template as unknown as object, createdFromConnectionId },
  });
}

export async function listMappingTemplates(agencyId: string) {
  return db.mappingTemplate.findMany({ where: { agencyId }, orderBy: { createdAt: "desc" } });
}

export async function deleteMappingTemplate(agencyId: string, templateId: string) {
  const template = await db.mappingTemplate.findUnique({ where: { id: templateId } });
  if (!template || template.agencyId !== agencyId) {
    throw new Response("Mapping template not found.", { status: 404 });
  }
  await db.mappingTemplate.delete({ where: { id: templateId } });
}

// Backs the white-label report (agency.reports.$shopId.tsx) -- aggregate counts rather than the
// full row lists activity.server.ts/reconciliation already expose to the merchant themselves,
// since this is meant to be a client-facing summary an agency hands off, not a debugging tool.
export type SyncReport = {
  jobCounts: { status: string; count: number }[];
  reconciliationCounts: { status: string; count: number }[];
  recentErrors: { id: string; message: string; occurredAt: Date }[];
};

export async function getSyncReport(connectionId: string, since: Date): Promise<SyncReport> {
  const [jobsByStatus, reconciliationByStatus, recentErrors] = await Promise.all([
    db.syncJob.groupBy({
      by: ["status"],
      where: { connectionId, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    db.reconciliationRecord.groupBy({
      by: ["status"],
      where: { connectionId, checkedAt: { gte: since } },
      _count: { _all: true },
    }),
    db.activityLog.findMany({
      where: { connectionId, severity: "error", occurredAt: { gte: since } },
      orderBy: { occurredAt: "desc" },
      take: 20,
    }),
  ]);

  return {
    jobCounts: jobsByStatus.map((r) => ({ status: r.status, count: r._count._all })),
    reconciliationCounts: reconciliationByStatus.map((r) => ({
      status: r.status,
      count: r._count._all,
    })),
    recentErrors,
  };
}

// Most-recent template for this ERP type from the agency linked to this shop, if any -- the
// prefill lookup used by app.connect.$erpType.mapping.tsx before falling back to adapter defaults.
export async function findMappingTemplateForShop(
  shopId: string,
  erpType: string,
): Promise<FieldMapping[] | null> {
  const link = await db.agencyClientLink.findFirst({ where: { shopId } });
  if (!link) return null;

  const template = await db.mappingTemplate.findFirst({
    where: { agencyId: link.agencyId, erpType },
    orderBy: { createdAt: "desc" },
  });
  if (!template) return null;

  return template.template as unknown as FieldMapping[];
}
