import crypto from "node:crypto";
import db from "../db.server";
import { encrypt } from "../utils/encryption.server";
import type { WebhookEventType } from "./webhookEventTypes";

export type { WebhookEventType } from "./webhookEventTypes";

export type ChannelKind = "generic" | "slack" | "email";

export async function createWebhookSubscription(
  connectionId: string,
  url: string,
  eventTypes: WebhookEventType[],
  channelKind: ChannelKind = "generic",
): Promise<{ id: string; secret: string }> {
  const secret = crypto.randomBytes(32).toString("hex");
  const subscription = await db.webhookSubscription.create({
    data: {
      connectionId,
      url,
      eventTypes: eventTypes.join(","),
      secretEncrypted: encrypt(secret),
      channelKind,
    },
  });
  // The signing secret is only ever returned here, at creation time -- like the API key, it's
  // hashed/encrypted at rest and never re-exposed through a GET. Unused by 'slack'/'email'
  // deliveries (see webhookDispatch.server.ts) but generated uniformly regardless of channel kind
  // -- harmless, and keeps this function's shape the same for every kind.
  return { id: subscription.id, secret };
}

export async function listWebhookSubscriptions(connectionId: string) {
  const rows = await db.webhookSubscription.findMany({ where: { connectionId } });
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    eventTypes: r.eventTypes.split(","),
    channelKind: r.channelKind as ChannelKind,
    createdAt: r.createdAt,
  }));
}

export async function deleteWebhookSubscription(connectionId: string, id: string): Promise<boolean> {
  const result = await db.webhookSubscription.deleteMany({ where: { id, connectionId } });
  return result.count > 0;
}

export async function findSubscriptionsForEvent(connectionId: string, eventType: WebhookEventType) {
  const rows = await db.webhookSubscription.findMany({ where: { connectionId } });
  return rows.filter((r) => r.eventTypes.split(",").includes(eventType));
}
