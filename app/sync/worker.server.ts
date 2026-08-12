import { Worker, type Job } from "bullmq";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { getRedisConnection } from "./redis.server";
import { SYNC_QUEUE_NAME } from "./queue.server";
import { getConnection, getConnectionShopDomain, getFieldMappings, loadErpCredentials } from "../models/connections.server";
import { createAdapter, getAuthType, getDefaultFieldMappings } from "../adapters/registry.server";
import { shopifyOrderToCanonical, type ShopifyOrderPayload } from "./shopifyToCanonical";
import { logActivity } from "./activityLog.server";
import { dispatchEvent } from "./webhookDispatch.server";
import { recordOrderSyncUsage } from "../utils/billing.server";

// Runs in-process alongside the web app for now (per README.md's Build Plan, Milestone 3's
// worker-deploy decision) rather than as the separate Railway service the dev spec's architecture
// calls for -- splitting it out later is a deploy-config change, not a rewrite, since this module
// doesn't know or care which process it's running in.
//
// Concurrency 1: open-source BullMQ has no job-groups feature (Pro-only) to sequence per-resource
// work, so global FIFO is the simplest correct way to satisfy §7's ordering requirement (same-
// order jobs process in sequence). Trades away parallelism across unrelated orders -- fine at
// current volume, revisit if/when throughput actually demands it.
const CONCURRENCY = 1;

// Exported for worker.test.ts -- pure enough (only touches db/logActivity/dispatchEvent, no
// BullMQ/Redis of its own) to unit test directly without spinning up a real Worker.
export async function processJob(job: Job<{ syncJobId: string }>): Promise<void> {
  const syncJob = await db.syncJob.findUniqueOrThrow({ where: { id: job.data.syncJobId } });

  // A job already in "processing" here (rather than "queued" on the first attempt, or "failed" on
  // a normal retry after handleJobFailure ran) means a previous attempt got far enough to mark
  // itself in-flight but the process died before recording success or failure -- e.g. a hard
  // restart or OOM-kill, not a thrown error (handleJobFailure always sets "failed"/"dead_letter"
  // before this could happen). For a live job that's ambiguous: adapter.pushOrder may have already
  // reached the ERP. There's no adapter-side idempotency key yet (see the pushOrder call below) to
  // safely auto-retry without risking a duplicate order, so stop and surface it for manual
  // verification instead of silently pushing again. Shadow jobs never touch the ERP, so this
  // ambiguity doesn't apply to them.
  if (syncJob.status === "processing" && syncJob.mode === "live") {
    await db.syncJob.update({
      where: { id: syncJob.id },
      data: {
        status: "dead_letter",
        lastError:
          "Resumed mid-flight after an apparent crash (status was already 'processing'); needs manual " +
          "verification against the ERP before retrying, since no adapter-side idempotency key exists " +
          "to safely auto-retry a push that may have already succeeded.",
      },
    });
    await logActivity(
      syncJob.connectionId,
      "sync_needs_manual_review",
      `Order sync for ${syncJob.shopifyReferenceId} was interrupted mid-push and needs manual review -- ` +
        `it may have already reached the ERP.`,
      "error",
    );
    await dispatchEvent(syncJob.connectionId, "sync_failed", {
      shopifyOrderId: syncJob.shopifyReferenceId,
      error: "Interrupted mid-push; needs manual review.",
    });
    return;
  }

  await db.syncJob.update({
    where: { id: syncJob.id },
    data: { status: "processing", attempts: { increment: 1 } },
  });

  const connection = await getConnection(syncJob.connectionId);
  if (!connection || connection.status === "disabled") {
    // Defense-in-depth: a merchant could disconnect between enqueue and processing.
    throw new Error(`Connection ${syncJob.connectionId} is disabled or missing; refusing to process.`);
  }

  const savedMappings = await getFieldMappings(connection.id);
  const mapping =
    savedMappings.length > 0
      ? savedMappings.map((m) => ({
          shopifyField: m.shopifyField,
          erpField: m.erpField,
          transformRule: m.transformRule ?? undefined,
          isRequired: m.isRequired,
        }))
      : getDefaultFieldMappings(connection.erpType).mappings;

  if (syncJob.entityType !== "order") {
    throw new Error(`No processor implemented yet for entityType "${syncJob.entityType}".`);
  }

  const canonicalOrder = shopifyOrderToCanonical(
    connection.shopId,
    syncJob.payload as unknown as ShopifyOrderPayload,
  );

  // syncJob.mode was decided at enqueue time from the connection's state then, not re-derived
  // here -- a connection that goes live mid-flight for an already-queued shadow job shouldn't
  // retroactively push something that was queued to be logged-only (see queue.server.ts's
  // comment on EnqueueSyncJobInput.mode).
  if (syncJob.mode === "shadow") {
    // Milestone 7 parallel-run mode (dev spec §14): "writing to a staging area or dry-run log
    // only, not actually pushing to the ERP." Logs the canonical order rather than each adapter's
    // ERP-native payload shape -- that transform is adapter-internal (inside pushOrder itself),
    // not exposed generically through ERPAdapter, so the canonical form is what's available to
    // show without breaking that separation. Still useful for comparison: SKUs, quantities,
    // customer, totals are all visible even without the exact ERP-native JSON.
    await db.syncJob.update({
      where: { id: syncJob.id },
      data: { status: "success", completedAt: new Date() },
    });
    await logActivity(
      connection.id,
      "shadow_sync",
      `[Shadow] Order ${canonicalOrder.id} would sync to ${connection.erpType}. ` +
        `Canonical payload: ${JSON.stringify(canonicalOrder)}`,
    );
    return;
  }

  // Defense-in-depth (erp-connector-fixes-spec.md F4): the DB-level unique constraint on SyncJob
  // (connectionId, entityType, shopifyReferenceId, contentFingerprint) is the primary guard
  // against a duplicate ERP push, but it doesn't cover legacy/NULL-fingerprint rows (Postgres
  // treats NULLs as distinct, so it's not enforced for those) or a resource that ended up with
  // two independent SyncJob rows some other way. If a different job for the same resource already
  // pushed successfully, don't push again -- adopt its result instead.
  //
  // Residual gap this doesn't close: a process crash between adapter.pushOrder resolving and the
  // status update below (this same job, not a different one) would still retry the push on the
  // next attempt, since nothing here would have recorded it yet. Closing that fully needs an
  // ERP-side idempotency key per adapter, which doesn't exist yet -- out of scope for this pass.
  if (syncJob.shopifyReferenceId) {
    const alreadySynced = await db.syncJob.findFirst({
      where: {
        id: { not: syncJob.id },
        connectionId: syncJob.connectionId,
        entityType: syncJob.entityType,
        shopifyReferenceId: syncJob.shopifyReferenceId,
        status: "success",
        erpDocumentRef: { not: null },
      },
    });
    if (alreadySynced) {
      await db.syncJob.update({
        where: { id: syncJob.id },
        data: { status: "success", erpDocumentRef: alreadySynced.erpDocumentRef, completedAt: new Date() },
      });
      await logActivity(
        connection.id,
        "order_synced",
        `Order ${canonicalOrder.id} already synced to ${connection.erpType} as ` +
          `${alreadySynced.erpDocumentRef} (duplicate sync job skipped).`,
      );
      return;
    }
  }

  const credentials = await loadErpCredentials(connection.id);
  if (!credentials) throw new Error(`No stored ERP credentials for connection ${connection.id}.`);

  const adapter = createAdapter(connection.erpType);
  const auth = await adapter.authenticate({ authType: getAuthType(connection.erpType), values: { ...credentials } });
  if (!auth.success) throw new Error(`ERP re-authentication failed: ${auth.message}`);

  const documentRef = await adapter.pushOrder(canonicalOrder, mapping);

  // Both rows describe the same outcome (this job succeeded, this connection is healthy) --
  // committed together so a crash between them can't leave the sync marked successful while the
  // connection's lastSuccessfulSyncAt still looks stale (or vice versa).
  await db.$transaction([
    db.syncJob.update({
      where: { id: syncJob.id },
      data: { status: "success", erpDocumentRef: documentRef.documentId, completedAt: new Date() },
    }),
    db.erpConnection.update({
      where: { id: connection.id },
      data: { lastSuccessfulSyncAt: new Date() },
    }),
  ]);
  await logActivity(
    connection.id,
    "order_synced",
    `Order ${canonicalOrder.id} synced to ${connection.erpType} as ${documentRef.documentType} ${documentRef.documentId}.`,
  );
  await dispatchEvent(connection.id, "order_synced", {
    shopifyOrderId: canonicalOrder.id,
    erpDocumentType: documentRef.documentType,
    erpDocumentId: documentRef.documentId,
  });
  // Billing usage recording is best-effort: a failure here shouldn't undo or fail an otherwise-
  // successful sync. recordOrderSyncUsage itself no-ops until ORDER_SYNC_USAGE_PRICE_USD is set
  // (decision D1 is still unresolved -- see billing.server.ts), so this is a no-op in practice
  // until an operator turns real pricing on.
  try {
    const shopDomain = await getConnectionShopDomain(connection.id);
    if (shopDomain) {
      const { admin } = await unauthenticated.admin(shopDomain);
      await recordOrderSyncUsage(admin, syncJob.id, canonicalOrder.id);
    }
  } catch (err) {
    await logActivity(
      connection.id,
      "billing_usage_record_failed",
      `Failed to record billing usage for order ${canonicalOrder.id}: ` +
        `${err instanceof Error ? err.message : "unknown error"}`,
      "warning",
    );
  }
}

// Exported for worker.test.ts, same rationale as processJob above. Wired to the real Worker's
// "failed" event below exactly as before this was pulled out.
export async function handleJobFailure(job: Job<{ syncJobId: string }> | undefined, err: Error): Promise<void> {
  if (!job) return;
  const attemptsExhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
  const syncJob = await db.syncJob.update({
    where: { id: job.data.syncJobId },
    data: {
      status: attemptsExhausted ? "dead_letter" : "failed",
      lastError: err.message,
    },
  });
  await logActivity(
    syncJob.connectionId,
    attemptsExhausted ? "sync_dead_letter" : "sync_failed",
    attemptsExhausted
      ? `Order sync for ${syncJob.shopifyReferenceId} failed after ${job.attemptsMade} attempts and needs manual review: ${err.message}`
      : `Order sync for ${syncJob.shopifyReferenceId} failed (attempt ${job.attemptsMade}), will retry: ${err.message}`,
    attemptsExhausted ? "error" : "warning",
  );
  // Fired only once retries are exhausted -- a transient failure that's about to retry isn't
  // the "sync failed" event product spec §7.7 describes an agency wanting to react to.
  if (attemptsExhausted) {
    await dispatchEvent(syncJob.connectionId, "sync_failed", {
      shopifyOrderId: syncJob.shopifyReferenceId,
      error: err.message,
    });
  }
}

declare global {
  // eslint-disable-next-line no-var -- module-level singleton guard, see comment below
  var __syncWorker: Worker | undefined;
}

// Guards against creating a second Worker on Vite's dev-mode module re-evaluation (HMR) -- in
// production this file is only ever imported once, at process start, via entry.server.tsx.
// Wrapped in try/catch: getRedisConnection() throws synchronously if REDIS_URL is unset, and this
// block runs as a module-load side effect from entry.server.tsx. Previously that exception
// propagated out of module evaluation and crashed the entire web process -- not just sync, but
// OAuth install, GDPR webhooks, every route -- since Node can't finish loading the module graph.
// Catching it here means a missing/invalid REDIS_URL only disables sync (orders queue up and never
// process until it's fixed and the process restarts), while the rest of the app keeps serving.
if (!global.__syncWorker) {
  try {
    const worker = new Worker(SYNC_QUEUE_NAME, processJob, {
      connection: getRedisConnection(),
      concurrency: CONCURRENCY,
    });

    worker.on("failed", handleJobFailure);

    global.__syncWorker = worker;
  } catch (err) {
    console.error(
      "Sync worker failed to start (REDIS_URL missing or invalid) -- the web app will still serve " +
        "requests, but orders will queue and never sync until this is fixed and the process restarts.",
      err,
    );
  }
}
