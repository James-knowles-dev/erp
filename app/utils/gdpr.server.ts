import { Prisma } from "@prisma/client";
import db from "../db.server";
import { logActivity } from "../sync/activityLog.server";

// Backs the two mandatory GDPR webhooks (customers/data_request, customers/redact). Both were
// previously stubs (see git history) written when no customer PII existed anywhere in the schema
// -- as of Milestone 3+, SyncJob.payload carries the raw Shopify order webhook payload (customer
// email, billing/shipping address) and ActivityLog.message can carry the same, via shadow-sync's
// full canonical-order dump (see worker.server.ts). Both need real handling now.

interface GdprCustomer {
  id?: number | string;
  email?: string;
}

interface GdprWebhookPayload {
  customer?: GdprCustomer | null;
  orders_requested?: (number | string)[];
  orders_to_redact?: (number | string)[];
}

interface GdprIdentifiers {
  customerId?: string;
  customerEmail?: string;
  orderIds: string[];
}

function extractIdentifiers(payload: GdprWebhookPayload, orderIdField: "orders_requested" | "orders_to_redact"): GdprIdentifiers {
  return {
    customerId: payload.customer?.id != null ? String(payload.customer.id) : undefined,
    customerEmail: payload.customer?.email || undefined,
    orderIds: (payload[orderIdField] ?? []).map(String),
  };
}

// Shared match test for anything shaped like { shopifyReferenceId, payload } -- both a real
// SyncJob row and an item inside a gdpr_data_request ActivityLog.metadata export dump (see
// GdprExportItem below) satisfy this shape.
function recordMatchesIdentifiers(
  record: { shopifyReferenceId: string | null; payload: Prisma.JsonValue | null },
  ids: GdprIdentifiers,
): boolean {
  if (ids.orderIds.includes(record.shopifyReferenceId ?? "")) return true;

  const payload = record.payload as { customer?: GdprCustomer | null; email?: string } | null;
  if (!payload || typeof payload !== "object") return false;
  if (ids.customerId != null && String(payload.customer?.id ?? "") === ids.customerId) return true;
  if (ids.customerEmail != null && (payload.customer?.email === ids.customerEmail || payload.email === ids.customerEmail)) return true;
  return false;
}

// Fetches every order-type SyncJob for the shop's connections and filters in memory -- matching
// against a customer id/email nested inside the JSON payload isn't expressible as a Postgres
// where-clause without a raw query, and per-shop GDPR request volume is low enough that this
// isn't a hot path worth optimizing.
async function findMatchingSyncJobs(shopId: string, ids: GdprIdentifiers) {
  const connections = await db.erpConnection.findMany({ where: { shopId }, select: { id: true } });
  if (connections.length === 0) return [];

  const jobs = await db.syncJob.findMany({
    where: { connectionId: { in: connections.map((c) => c.id) }, entityType: "order" },
  });

  return jobs.filter((job) => recordMatchesIdentifiers(job, ids));
}

// One entry inside a gdpr_data_request ActivityLog row's `metadata` array -- see
// handleCustomerDataRequest. Structurally compatible with recordMatchesIdentifiers's expected
// shape via { shopifyReferenceId: shopifyOrderId, payload: data }.
interface GdprExportItem {
  shopifyOrderId: string | null;
  syncStatus: string;
  erpDocumentRef: string | null;
  data: Prisma.JsonValue | null;
}

// customers/data_request: Shopify's webhook itself is just an ack -- the actual data export goes
// back to the merchant through a separate channel per Shopify's documented flow. There's no
// export-delivery pipeline built yet (out of scope for this fix pass), so the collected data is
// staged in the activity log per connection -- retrievable by an operator within Shopify's
// required response window, rather than the request being silently dropped as it was before.
//
// The export payload (which necessarily contains the customer's PII -- that's the point of a data
// request) goes in `metadata`, a structured JSON column, not interpolated into `message`. This is
// what lets handleCustomerRedact scrub it precisely later instead of only being able to
// substring-match whatever happened to be embedded in free text (see F1 follow-up, hardening pass
// 2026-08-11).
export async function handleCustomerDataRequest(shopDomain: string, rawPayload: unknown): Promise<void> {
  const shop = await db.shop.findUnique({ where: { shopifyDomain: shopDomain } });
  if (!shop) return;

  const payload = rawPayload as GdprWebhookPayload;
  const ids = extractIdentifiers(payload, "orders_requested");
  const jobs = await findMatchingSyncJobs(shop.id, ids);

  const byConnection = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const existing = byConnection.get(job.connectionId) ?? [];
    existing.push(job);
    byConnection.set(job.connectionId, existing);
  }

  const identifierLabel = ids.customerId ?? ids.customerEmail ?? "unknown customer";
  for (const [connectionId, connectionJobs] of byConnection) {
    const exportPayload: GdprExportItem[] = connectionJobs.map((j) => ({
      shopifyOrderId: j.shopifyReferenceId,
      syncStatus: j.status,
      erpDocumentRef: j.erpDocumentRef,
      data: j.payload,
    }));
    await logActivity(
      connectionId,
      "gdpr_data_request",
      `Customer data request for ${identifierLabel}: ${connectionJobs.length} matching order ` +
        `record(s) staged for export -- see this entry's metadata.`,
      "warning",
      exportPayload as unknown as Prisma.InputJsonValue,
    );
  }
}

function redactString(value: unknown): unknown {
  return typeof value === "string" && value.length > 0 ? "[REDACTED]" : value;
}

// Redacts PII fields on the raw Shopify order payload shape stored in SyncJob.payload (see
// ShopifyOrderPayload in shopifyToCanonical.ts) while preserving line items / totals / ids needed
// for accounting and reconciliation history.
function redactOrderPayload(payload: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const clone = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;

  if (clone.customer && typeof clone.customer === "object") {
    const customer = clone.customer as Record<string, unknown>;
    customer.email = redactString(customer.email);
  }
  clone.email = redactString(clone.email);

  for (const key of ["billing_address", "shipping_address"]) {
    const addr = clone[key];
    if (addr && typeof addr === "object") {
      const address = addr as Record<string, unknown>;
      address.first_name = redactString(address.first_name);
      address.last_name = redactString(address.last_name);
      address.company = redactString(address.company);
      address.address1 = redactString(address.address1);
      address.address2 = redactString(address.address2);
      address.phone = redactString(address.phone);
    }
  }

  return clone as Prisma.JsonValue;
}

// Scrubs PII out of any gdpr_data_request export dump (see handleCustomerDataRequest) that
// matches the current redact request -- matched item-by-item via recordMatchesIdentifiers, same
// as SyncJob rows, rather than assuming every item in a given log entry belongs to one customer.
// Returns true if anything in `items` was changed, so the caller only writes back rows that
// actually needed it.
function redactExportItems(items: GdprExportItem[], ids: GdprIdentifiers): { changed: boolean; items: GdprExportItem[] } {
  let changed = false;
  const redacted = items.map((item) => {
    if (!recordMatchesIdentifiers({ shopifyReferenceId: item.shopifyOrderId, payload: item.data }, ids)) return item;
    changed = true;
    return { ...item, data: redactOrderPayload(item.data) };
  });
  return { changed, items: redacted };
}

// customers/redact: anonymizes matching SyncJob payloads and gdpr_data_request export dumps in
// place, and scrubs the customer's email out of any other ActivityLog message that embedded it
// verbatim (shadow-sync logs the full canonical order, including customer.email, per
// worker.server.ts).
export async function handleCustomerRedact(shopDomain: string, rawPayload: unknown): Promise<void> {
  const shop = await db.shop.findUnique({ where: { shopifyDomain: shopDomain } });
  if (!shop) return;

  const payload = rawPayload as GdprWebhookPayload;
  const ids = extractIdentifiers(payload, "orders_to_redact");
  const jobs = await findMatchingSyncJobs(shop.id, ids);

  for (const job of jobs) {
    await db.syncJob.update({
      where: { id: job.id },
      data: { payload: redactOrderPayload(job.payload) ?? Prisma.JsonNull },
    });
  }

  const connections = await db.erpConnection.findMany({ where: { shopId: shop.id }, select: { id: true } });
  const connectionIdList = connections.map((c) => c.id);

  // Structured pass: gdpr_data_request entries carry PII in `metadata`, matched the same way as
  // SyncJob rows (order id, customer id, or email) -- not dependent on the redact payload
  // including an email, unlike the free-text pass below.
  if (connectionIdList.length > 0) {
    const metadataLogs = await db.activityLog.findMany({
      where: { connectionId: { in: connectionIdList }, metadata: { not: Prisma.JsonNull } },
    });
    for (const log of metadataLogs) {
      const items = log.metadata as unknown as GdprExportItem[] | null;
      if (!Array.isArray(items)) continue;
      const result = redactExportItems(items, ids);
      if (result.changed) {
        await db.activityLog.update({
          where: { id: log.id },
          data: { metadata: result.items as unknown as Prisma.InputJsonValue },
        });
      }
    }
  }

  // Free-text pass: catches PII embedded directly in `message` (e.g. worker.server.ts's
  // shadow_sync log). Email-only, since that's the one identifier reliably present verbatim in
  // that text -- order ids and customer ids appear in JSON.stringify'd form there too, but
  // scrubbing on those would risk redacting unrelated numeric data that happens to match.
  if (ids.customerEmail) {
    for (const connectionId of connectionIdList) {
      const logs = await db.activityLog.findMany({
        where: { connectionId, message: { contains: ids.customerEmail } },
      });
      for (const log of logs) {
        await db.activityLog.update({
          where: { id: log.id },
          data: { message: log.message.split(ids.customerEmail).join("[REDACTED]") },
        });
      }
    }
  }

  const connectionIds = new Set(jobs.map((j) => j.connectionId));
  const identifierLabel = ids.customerId ?? ids.customerEmail ?? "unknown customer";
  for (const connectionId of connectionIds) {
    await logActivity(
      connectionId,
      "gdpr_redact",
      `Customer data for ${identifierLabel} redacted per Shopify customers/redact request.`,
      "warning",
    );
  }
}
