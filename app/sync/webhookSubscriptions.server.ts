import crypto from "node:crypto";
import db from "../db.server";
import { encrypt } from "../utils/encryption.server";
import type { WebhookEventType } from "./webhookEventTypes";

export type { WebhookEventType } from "./webhookEventTypes";

export async function createWebhookSubscription(
  connectionId: string,
  url: string,
  eventTypes: WebhookEventType[],
): Promise<{ id: string; secret: string }> {
  const secret = crypto.randomBytes(32).toString("hex");
  const subscription = await db.webhookSubscription.create({
    data: {
      connectionId,
      url,
      eventTypes: eventTypes.join(","),
      secretEncrypted: encrypt(secret),
    },
  });
  // The signing secret is only ever returned here, at creation time -- like the API key, it's
  // hashed/encrypted at rest and never re-exposed through a GET.
  return { id: subscription.id, secret };
}

export async function listWebhookSubscriptions(connectionId: string) {
  const rows = await db.webhookSubscription.findMany({ where: { connectionId } });
  return rows.map((r) => ({ id: r.id, url: r.url, eventTypes: r.eventTypes.split(","), createdAt: r.createdAt }));
}

export async function deleteWebhookSubscription(connectionId: string, id: string): Promise<boolean> {
  const result = await db.webhookSubscription.deleteMany({ where: { id, connectionId } });
  return result.count > 0;
}

export async function findSubscriptionsForEvent(connectionId: string, eventType: WebhookEventType) {
  const rows = await db.webhookSubscription.findMany({ where: { connectionId } });
  return rows.filter((r) => r.eventTypes.split(",").includes(eventType));
}
