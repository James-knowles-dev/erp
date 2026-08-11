import { Worker, type Job } from "bullmq";
import db from "../db.server";
import { getRedisConnection } from "./redis.server";
import { SYNC_QUEUE_NAME } from "./queue.server";
import { getConnection, getFieldMappings, loadErpCredentials } from "../models/connections.server";
import { createAdapter, getAuthType, getDefaultFieldMappings } from "../adapters/registry.server";
import { shopifyOrderToCanonical, type ShopifyOrderPayload } from "./shopifyToCanonical";
import { logActivity } from "./activityLog.server";
import { dispatchEvent } from "./webhookDispatch.server";

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

  await db.syncJob.update({
    where: { id: syncJob.id },
    data: { status: "success", erpDocumentRef: documentRef.documentId, completedAt: new Date() },
  });
  await db.erpConnection.update({
    where: { id: connection.id },
    data: { lastSuccessfulSyncAt: new Date() },
  });
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
if (!global.__syncWorker) {
  const worker = new Worker(SYNC_QUEUE_NAME, processJob, {
    connection: getRedisConnection(),
    concurrency: CONCURRENCY,
  });

  worker.on("failed", handleJobFailure);

  global.__syncWorker = worker;
}
