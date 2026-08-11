import { Queue } from "bullmq";
import { Prisma } from "@prisma/client";
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
  // 'live' pushes to the ERP; 'shadow' runs the same transform/validation but never calls the
  // adapter's push methods (Milestone 7, dev spec §14's parallel-run mode). Required, not
  // defaulted -- every call site should have already decided this from the connection's state
  // (see syncModeForConnection in connections.server.ts) rather than silently assuming live.
  mode: "live" | "shadow";
  // Dedup key (erp-connector-fixes-spec.md F4) -- see computeOrderFingerprint in
  // shopifyToCanonical.ts. Optional because non-order entity types don't compute one yet; those
  // fall back to the in-flight-only check below, same as before this fix.
  contentFingerprint?: string;
}

// Idempotency per erp-connector-dev-spec.md §7: a webhook redelivery for work already
// queued/processing is a no-op. This first check alone only catches a redelivery of a job that's
// still in flight -- it doesn't stop a redelivery *after* the original job already reached a
// terminal status, and it's check-then-act, not atomic, so two concurrent deliveries could both
// pass it before either INSERT commits.
//
// The unique constraint on (connectionId, entityType, shopifyReferenceId, contentFingerprint) --
// see schema.prisma's SyncJob model -- is what actually closes both gaps: an identical redelivery
// (same fingerprint) collides on INSERT and is treated as a no-op below, regardless of whether the
// original job is still in flight or long since completed, and two concurrent identical
// deliveries can't both win the race, since only one INSERT can succeed. A genuinely new event
// for the same resource (different fingerprint -- status or line items actually changed) still
// gets its own row, whether or not a prior job for that resource is mid-flight; BullMQ's
// concurrency-1 worker (see worker.server.ts) is what keeps same-order jobs processed in order,
// not this function.
export async function enqueueSyncJob(
  input: EnqueueSyncJobInput,
): Promise<{ enqueued: boolean; jobId: string }> {
  const existingInFlight = await db.syncJob.findFirst({
    where: {
      connectionId: input.connectionId,
      entityType: input.entityType,
      shopifyReferenceId: input.shopifyReferenceId,
      status: { in: ["queued", "processing"] },
    },
  });
  if (existingInFlight) return { enqueued: false, jobId: existingInFlight.id };

  let syncJob;
  try {
    syncJob = await db.syncJob.create({
      data: {
        connectionId: input.connectionId,
        entityType: input.entityType,
        direction: input.direction,
        shopifyReferenceId: input.shopifyReferenceId,
        status: "queued",
        payload: input.payload,
        mode: input.mode,
        contentFingerprint: input.contentFingerprint ?? null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Unique constraint hit: either a genuinely concurrent duplicate that lost the race, or a
      // redelivery of an already-terminal job with an identical fingerprint -- both cases mean
      // "don't enqueue again," so return the row that won instead of throwing.
      const existing = await db.syncJob.findFirst({
        where: {
          connectionId: input.connectionId,
          entityType: input.entityType,
          shopifyReferenceId: input.shopifyReferenceId,
          contentFingerprint: input.contentFingerprint ?? null,
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing) return { enqueued: false, jobId: existing.id };
    }
    throw err;
  }

  await getQueue().add(
    input.entityType,
    { syncJobId: syncJob.id },
    { attempts: 5, backoff: { type: "exponential", delay: 5000 } },
  );

  return { enqueued: true, jobId: syncJob.id };
}
