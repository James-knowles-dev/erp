import crypto from "node:crypto";
import { Queue, Worker } from "bullmq";
import db from "../db.server";
import { decrypt } from "../utils/encryption.server";
import { getRedisConnection } from "./redis.server";
import { findSubscriptionsForEvent, type WebhookEventType } from "./webhookSubscriptions.server";

// Delivers events to agency-registered webhook subscriptions (product spec §7.7), signed the same
// way Shopify signs its own webhooks to us (HMAC-SHA256 over the raw body) so a subscriber can
// verify authenticity. Reuses the same BullMQ + Redis infrastructure as the sync engine rather
// than building a second delivery mechanism from scratch.

const WEBHOOK_DELIVERY_QUEUE_NAME = "webhook-deliveries";

let queue: Queue | undefined;
function getQueue(): Queue {
  if (!queue) queue = new Queue(WEBHOOK_DELIVERY_QUEUE_NAME, { connection: getRedisConnection() });
  return queue;
}

export async function dispatchEvent(
  connectionId: string,
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  const subscriptions = await findSubscriptionsForEvent(connectionId, eventType);
  for (const subscription of subscriptions) {
    await getQueue().add(
      "deliver",
      { subscriptionId: subscription.id, eventType, payload },
      { attempts: 5, backoff: { type: "exponential", delay: 5000 } },
    );
  }
}

interface DeliveryJobData {
  subscriptionId: string;
  eventType: WebhookEventType;
  payload: Record<string, unknown>;
}

async function processDelivery(job: { data: DeliveryJobData }): Promise<void> {
  const { subscriptionId, eventType, payload } = job.data;
  const subscription = await db.webhookSubscription.findUnique({ where: { id: subscriptionId } });
  if (!subscription) return; // deleted since the event fired -- nothing to deliver to

  const secret = decrypt(subscription.secretEncrypted);
  const body = JSON.stringify({ eventType, payload, occurredAt: new Date().toISOString() });
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");

  const response = await fetch(subscription.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-ERP-Connector-Event": eventType,
      "X-ERP-Connector-Signature": signature,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Webhook delivery to ${subscription.url} failed: ${response.status}`);
  }
}

declare global {
  // eslint-disable-next-line no-var -- module-level singleton guard, see worker.server.ts
  var __webhookDeliveryWorker: Worker | undefined;
}

if (!global.__webhookDeliveryWorker) {
  global.__webhookDeliveryWorker = new Worker(WEBHOOK_DELIVERY_QUEUE_NAME, processDelivery, {
    connection: getRedisConnection(),
    concurrency: 5, // deliveries to different subscribers are independent -- no ordering requirement like sync_jobs has
  });
}
