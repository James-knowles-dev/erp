import crypto from "node:crypto";
import { Queue, Worker } from "bullmq";
import db from "../db.server";
import { decrypt } from "../utils/encryption.server";
import { sendAlertEmail } from "../utils/email.server";
import { getRedisConnection } from "./redis.server";
import { findSubscriptionsForEvent, type ChannelKind, type WebhookEventType } from "./webhookSubscriptions.server";

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

// Human-readable rendering of an event, shared by the 'slack' and 'email' channel kinds -- 'generic'
// forwards the raw signed JSON envelope instead, since that channel's whole point is machine
// consumption by an agency's own script, not a person reading it.
function formatAlertMessage(eventType: WebhookEventType, payload: Record<string, unknown>): { subject: string; text: string } {
  switch (eventType) {
    case "sync_failed":
      return {
        subject: "ERP sync failed",
        text: `Order ${payload.shopifyOrderId ?? "unknown"} failed to sync: ${payload.error ?? "unknown error"}`,
      };
    case "reconciliation_alert":
      return {
        subject: "Reconciliation discrepancy threshold exceeded",
        text: String(payload.message ?? "Reconciliation discrepancies are above the alert threshold."),
      };
    case "order_synced":
      return {
        subject: "Order synced",
        text: `Order ${payload.shopifyOrderId ?? "unknown"} synced as ${payload.erpDocumentType ?? "?"} ${payload.erpDocumentId ?? "?"}.`,
      };
    case "order_received":
      return { subject: "Order received", text: `Order ${payload.shopifyOrderId ?? "unknown"} received.` };
  }
}

async function deliverGeneric(url: string, secret: string, eventType: WebhookEventType, payload: Record<string, unknown>): Promise<void> {
  const body = JSON.stringify({ eventType, payload, occurredAt: new Date().toISOString() });
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-ERP-Connector-Event": eventType,
      "X-ERP-Connector-Signature": signature,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Webhook delivery to ${url} failed: ${response.status}`);
  }
}

// Slack's incoming-webhook contract expects exactly {text: "..."} (or block-kit JSON) with no
// custom headers -- posting our signed generic envelope to it would just get a 400 back, so this
// is a distinct delivery shape, not a variant of deliverGeneric.
async function deliverSlack(url: string, eventType: WebhookEventType, payload: Record<string, unknown>): Promise<void> {
  const { subject, text } = formatAlertMessage(eventType, payload);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `*${subject}*\n${text}` }),
  });
  if (!response.ok) {
    throw new Error(`Slack delivery to ${url} failed: ${response.status}`);
  }
}

// `to` holds a destination email address for this channel kind, not an HTTP endpoint -- see the
// channelKind comment on the WebhookSubscription model.
async function deliverEmail(to: string, eventType: WebhookEventType, payload: Record<string, unknown>): Promise<void> {
  const { subject, text } = formatAlertMessage(eventType, payload);
  await sendAlertEmail(to, `[ERP Connector] ${subject}`, text);
}

// Exported for webhookDispatch.test.ts -- same rationale as worker.server.ts's processJob export:
// pure enough (only touches db/decrypt/sendAlertEmail/fetch) to unit test directly without a real
// BullMQ Worker.
export async function processDelivery(job: { data: DeliveryJobData }): Promise<void> {
  const { subscriptionId, eventType, payload } = job.data;
  const subscription = await db.webhookSubscription.findUnique({ where: { id: subscriptionId } });
  if (!subscription) return; // deleted since the event fired -- nothing to deliver to

  const channelKind = subscription.channelKind as ChannelKind;
  switch (channelKind) {
    case "slack":
      return deliverSlack(subscription.url, eventType, payload);
    case "email":
      return deliverEmail(subscription.url, eventType, payload);
    case "generic":
    default:
      return deliverGeneric(subscription.url, decrypt(subscription.secretEncrypted), eventType, payload);
  }
}

declare global {
  // eslint-disable-next-line no-var -- module-level singleton guard, see worker.server.ts
  var __webhookDeliveryWorker: Worker | undefined;
}

// Guarded like worker.server.ts's Worker below: getRedisConnection() throws synchronously if
// REDIS_URL is unset, and this runs as a module-load side effect from entry.server.tsx -- letting
// that escape would crash the entire web process (OAuth, GDPR webhooks, everything), not just
// webhook delivery. Catching it here means a misconfigured/down Redis only disables delivery.
if (!global.__webhookDeliveryWorker) {
  try {
    global.__webhookDeliveryWorker = new Worker(WEBHOOK_DELIVERY_QUEUE_NAME, processDelivery, {
      connection: getRedisConnection(),
      concurrency: 5, // deliveries to different subscribers are independent -- no ordering requirement like sync_jobs has
    });
  } catch (err) {
    console.error("Webhook delivery worker failed to start (REDIS_URL missing or invalid):", err);
  }
}
