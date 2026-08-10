import { Queue } from "bullmq";
import type { Prisma } from "@prisma/client";
import db from "../db.server";
import { getRedisConnection } from "./redis.server";

export const SYNC_QUEUE_NAME = "sync-jobs";

let queue: Queue | undefined;

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(SYNC_QUEUE_NAME, { connection: getRedisConnection() });
  }
  return queue;
}

export interface EnqueueSyncJobInput {
  connectionId: string;
  entityType: "order" | "refund" | "inventory" | "customer" | "product";
  direction: "shopify_to_erp" | "erp_to_shopify";
  shopifyReferenceId: string;
  payload: Prisma.InputJsonValue;
}

// Idempotency per erp-connector-dev-spec.md §7: a webhook redelivery for work already
// queued/processing is a no-op.
//
// KNOWN LIMITATION: this only dedupes, it doesn't distinguish "identical redelivery" from "a
// genuinely new event for the same resource while a prior one is still in flight" (e.g.
// orders/updated arriving while orders/create for the same order hasn't finished processing yet)
// -- the latter is currently dropped rather than queued to run after. Open-source BullMQ has no
// job-groups feature (that's a Pro-only capability) to sequence per-resource work properly, so
// ordering here instead comes from running the worker at concurrency 1 (see worker.server.ts) --
// correct but not parallelized across unrelated orders. Fixing the dedupe-vs-drop gap needs a
// content fingerprint (e.g. the webhook payload's updated_at) to tell the two cases apart; not
// built yet.
export async function enqueueSyncJob(
  input: EnqueueSyncJobInput,
): Promise<{ enqueued: boolean; jobId: string }> {
  const existing = await db.syncJob.findFirst({
    where: {
      connectionId: input.connectionId,
      entityType: input.entityType,
      shopifyReferenceId: input.shopifyReferenceId,
      status: { in: ["queued", "processing"] },
    },
  });
  if (existing) return { enqueued: false, jobId: existing.id };

  const syncJob = await db.syncJob.create({
    data: {
      connectionId: input.connectionId,
      entityType: input.entityType,
      direction: input.direction,
      shopifyReferenceId: input.shopifyReferenceId,
      status: "queued",
      payload: input.payload,
    },
  });

  await getQueue().add(
    input.entityType,
    { syncJobId: syncJob.id },
    { attempts: 5, backoff: { type: "exponential", delay: 5000 } },
  );

  return { enqueued: true, jobId: syncJob.id };
}
