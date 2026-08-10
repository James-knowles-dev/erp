import { Worker, type Job } from "bullmq";
import db from "../db.server";
import { getRedisConnection } from "./redis.server";
import { SYNC_QUEUE_NAME } from "./queue.server";
import { getConnection, getFieldMappings, loadNetSuiteCredentials } from "../models/connections.server";
import { NetSuiteAdapter } from "../adapters/netsuite/adapter.server";
import { getDefaultFieldMappings } from "../adapters/netsuite/mapping";
import { shopifyOrderToCanonical, type ShopifyOrderPayload } from "./shopifyToCanonical";

// Runs in-process alongside the web app for now (per erp-connector-build-plan.md's Milestone 3
// worker-deploy decision) rather than as the separate Railway service the dev spec's architecture
// calls for -- splitting it out later is a deploy-config change, not a rewrite, since this module
// doesn't know or care which process it's running in.
//
// Concurrency 1: open-source BullMQ has no job-groups feature (Pro-only) to sequence per-resource
// work, so global FIFO is the simplest correct way to satisfy §7's ordering requirement (same-
// order jobs process in sequence). Trades away parallelism across unrelated orders -- fine at
// current volume, revisit if/when throughput actually demands it.
const CONCURRENCY = 1;

async function processJob(job: Job<{ syncJobId: string }>): Promise<void> {
  const syncJob = await db.syncJob.findUniqueOrThrow({ where: { id: job.data.syncJobId } });

  await db.syncJob.update({
    where: { id: syncJob.id },
    data: { status: "processing", attempts: { increment: 1 } },
  });

  const connection = await getConnection(syncJob.connectionId);
  if (!connection || !connection.wentLiveAt) {
    // Defense-in-depth: the webhook receiver already gates enqueueing on wentLiveAt, so this
    // shouldn't happen in practice, but a job shouldn't push to the ERP if it somehow does.
    throw new Error(`Connection ${syncJob.connectionId} is not live; refusing to push.`);
  }

  const credentials = await loadNetSuiteCredentials(connection.id);
  if (!credentials) throw new Error(`No stored NetSuite credentials for connection ${connection.id}.`);

  const adapter = new NetSuiteAdapter();
  const auth = await adapter.authenticate({ authType: "oauth2", values: { ...credentials } });
  if (!auth.success) throw new Error(`NetSuite re-authentication failed: ${auth.message}`);

  const savedMappings = await getFieldMappings(connection.id);
  const mapping =
    savedMappings.length > 0
      ? savedMappings.map((m) => ({
          shopifyField: m.shopifyField,
          erpField: m.erpField,
          transformRule: m.transformRule ?? undefined,
          isRequired: m.isRequired,
        }))
      : getDefaultFieldMappings().mappings;

  if (syncJob.entityType === "order") {
    const canonicalOrder = shopifyOrderToCanonical(
      connection.shopId,
      syncJob.payload as unknown as ShopifyOrderPayload,
    );
    const documentRef = await adapter.pushOrder(canonicalOrder, mapping);

    await db.syncJob.update({
      where: { id: syncJob.id },
      data: { status: "success", erpDocumentRef: documentRef.documentId, completedAt: new Date() },
    });
    await db.erpConnection.update({
      where: { id: connection.id },
      data: { lastSuccessfulSyncAt: new Date() },
    });
    return;
  }

  throw new Error(`No processor implemented yet for entityType "${syncJob.entityType}".`);
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

  worker.on("failed", async (job, err) => {
    if (!job) return;
    const attemptsExhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
    await db.syncJob.update({
      where: { id: job.data.syncJobId },
      data: {
        status: attemptsExhausted ? "dead_letter" : "failed",
        lastError: err.message,
      },
    });
  });

  global.__syncWorker = worker;
}
