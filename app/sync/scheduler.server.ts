import { Queue, Worker } from "bullmq";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { getRedisConnection } from "./redis.server";
import { runReconciliationForConnection } from "./reconciliation.server";

export const RECONCILIATION_QUEUE_NAME = "reconciliation";
const INTERVAL_MS = 15 * 60 * 1000; // per erp-connector-dev-spec.md §8: "not just nightly"

// unauthenticated.admin(shop) rather than authenticate.admin(request): this runs on a timer, not
// in response to an HTTP request, so there's no session to authenticate -- it uses the stored
// offline access token from each shop's original install instead (the standard shopify-app-remix
// pattern for background/webhook-triggered work).
async function processReconciliationTick(): Promise<void> {
  const liveConnections = await db.erpConnection.findMany({
    where: { wentLiveAt: { not: null }, status: "active" },
    include: { shop: true },
  });

  for (const connection of liveConnections) {
    try {
      const { admin } = await unauthenticated.admin(connection.shop.shopifyDomain);
      await runReconciliationForConnection(admin, connection);
    } catch (err) {
      console.error(`Reconciliation failed for connection ${connection.id}:`, err);
    }
  }
}

declare global {
  // eslint-disable-next-line no-var -- module-level singleton guard, see worker.server.ts
  var __reconciliationWorker: Worker | undefined;
}

// Same dev-mode HMR guard as worker.server.ts. upsertJobScheduler is itself idempotent (keyed by
// schedulerId), so re-registering on every server start doesn't create duplicate schedules.
if (!global.__reconciliationWorker) {
  const queue = new Queue(RECONCILIATION_QUEUE_NAME, { connection: getRedisConnection() });
  void queue.upsertJobScheduler("reconciliation-tick", { every: INTERVAL_MS }, { name: "tick" });

  global.__reconciliationWorker = new Worker(RECONCILIATION_QUEUE_NAME, processReconciliationTick, {
    connection: getRedisConnection(),
  });
}
