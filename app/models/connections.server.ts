import db from "../db.server";
import { decrypt, encrypt } from "../utils/encryption.server";

// Wraps the erp_connections table (README.md's Development Spec §5) with the encrypt/decrypt step
// so no route handler ever has to remember to do it itself.

export async function getOrCreateShop(shopifyDomain: string) {
  const existing = await db.shop.findUnique({ where: { shopifyDomain } });
  if (existing) return existing;
  // Shopify's OAuth (app/shopify.server.ts) is what actually authorizes the install; this just
  // backfills our own app-level Shop row the first time a shop reaches the wizard, in case the
  // access-token-storage hook that should create it on install hasn't been wired up yet.
  return db.shop.create({
    data: {
      shopifyDomain,
      accessTokenEncrypted: encrypt(""),
      installedAt: new Date(),
      planTier: "unassigned",
    },
  });
}

export async function createConnection(shopId: string, erpType: string) {
  return db.erpConnection.create({
    data: { shopId, erpType, environment: "sandbox", status: "pending" },
  });
}

export async function getConnection(id: string) {
  return db.erpConnection.findUnique({ where: { id } });
}

// For background-job contexts (the sync worker, billing usage recording) that need to call
// unauthenticated.admin(shop) but only ever had a connectionId to start from.
export async function getConnectionShopDomain(connectionId: string): Promise<string | null> {
  const connection = await db.erpConnection.findUnique({
    where: { id: connectionId },
    select: { shop: { select: { shopifyDomain: true } } },
  });
  return connection?.shop.shopifyDomain ?? null;
}

export async function getActiveConnectionForShop(shopId: string) {
  // v1 assumes one active connection per shop (dev spec §5) -- most recent non-disabled wins.
  return db.erpConnection.findFirst({
    where: { shopId, status: { not: "disabled" } },
    orderBy: { connectedAt: "desc" },
  });
}

export async function setEnvironment(connectionId: string, environment: "sandbox" | "production") {
  return db.erpConnection.update({ where: { id: connectionId }, data: { environment } });
}

// Generic across every adapter -- each ERP's config/token field names differ (NetSuite's
// accountId vs. Acumatica's instanceUrl), but they're always a flat string-keyed bundle, matching
// the ERPCredentials.values shape adapters already accept. Adding a third ERP needs zero changes
// here, which is the point: this is exactly the kind of thing that shouldn't need touching per
// adapter (see app/adapters/registry.server.ts's header comment).

// Persists partial config (e.g. accountId/clientId/clientSecret, or instanceUrl/clientId/
// clientSecret) before the OAuth redirect to the ERP, so the callback route (a separate request,
// after the merchant leaves and comes back) can load it back out to complete the token exchange.
// Status stays 'pending' -- this isn't a real connection yet, just enough state to survive the
// redirect round-trip. The client secret is the only genuinely sensitive value here, hence
// encrypting the whole bundle rather than passing it through the OAuth `state` param (which gets
// echoed back in a plain query string).
export async function storePartialErpConfig(connectionId: string, config: Record<string, string>) {
  return db.erpConnection.update({
    where: { id: connectionId },
    data: { credentialsEncrypted: encrypt(JSON.stringify(config)) },
  });
}

export async function storeErpCredentials(connectionId: string, credentials: Record<string, string>) {
  return db.erpConnection.update({
    where: { id: connectionId },
    data: {
      credentialsEncrypted: encrypt(JSON.stringify(credentials)),
      status: "active",
      connectedAt: new Date(),
    },
  });
}

export async function loadErpCredentials(connectionId: string): Promise<Record<string, string> | null> {
  const connection = await db.erpConnection.findUnique({ where: { id: connectionId } });
  if (!connection?.credentialsEncrypted) return null;
  return JSON.parse(decrypt(connection.credentialsEncrypted)) as Record<string, string>;
}

export async function setConnectionStatus(connectionId: string, status: string) {
  return db.erpConnection.update({ where: { id: connectionId }, data: { status } });
}

export async function saveFieldMappings(
  connectionId: string,
  mappings: { shopifyField: string; erpField: string; transformRule?: string; isRequired: boolean }[],
) {
  await db.fieldMapping.deleteMany({ where: { connectionId } });
  await db.fieldMapping.createMany({
    data: mappings.map((m) => ({ connectionId, ...m })),
  });
}

export async function getFieldMappings(connectionId: string) {
  return db.fieldMapping.findMany({ where: { connectionId } });
}

export async function saveEdgeCaseRules(connectionId: string, rules: Record<string, string>) {
  await db.edgeCaseRule.deleteMany({ where: { connectionId } });
  await db.edgeCaseRule.createMany({
    data: Object.entries(rules).map(([ruleKey, ruleValue]) => ({ connectionId, ruleKey, ruleValue })),
  });
}

export async function getEdgeCaseRules(connectionId: string): Promise<Record<string, string>> {
  const rows = await db.edgeCaseRule.findMany({ where: { connectionId } });
  return Object.fromEntries(rows.map((r) => [r.ruleKey, r.ruleValue]));
}

export async function setBackfillWindow(connectionId: string, backfillWindow: string) {
  return db.erpConnection.update({ where: { id: connectionId }, data: { backfillWindow } });
}

export async function markConnectionLive(connectionId: string) {
  return db.erpConnection.update({ where: { id: connectionId }, data: { wentLiveAt: new Date() } });
}

// Milestone 7 (dev spec §14): starts shadow-syncing without pushing to the ERP or starting
// billing -- distinct from markConnectionLive, which does both.
export async function startParallelRun(connectionId: string) {
  return db.erpConnection.update({
    where: { id: connectionId },
    data: { shadowModeStartedAt: new Date() },
  });
}

// The mode a newly-enqueued sync job should run in, given a connection's current state: live if
// it's gone live, shadow if only parallel-run has started, or null if neither -- meaning the
// caller shouldn't enqueue anything at all.
export function syncModeForConnection(connection: {
  wentLiveAt: Date | null;
  shadowModeStartedAt: Date | null;
}): "live" | "shadow" | null {
  if (connection.wentLiveAt) return "live";
  if (connection.shadowModeStartedAt) return "shadow";
  return null;
}
