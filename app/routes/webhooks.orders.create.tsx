import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { enqueueSyncJob } from "../sync/queue.server";
import type { ShopifyOrderPayload } from "../sync/shopifyToCanonical";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const shopRecord = await db.shop.findUnique({ where: { shopifyDomain: shop } });
  if (!shopRecord) return new Response();

  const connection = await db.erpConnection.findFirst({
    where: { shopId: shopRecord.id, status: { not: "disabled" } },
    orderBy: { connectedAt: "desc" },
  });

  // Not connected, or connected but hasn't gone live (wizard step 8) yet -- acknowledge without
  // enqueueing. Steps 1-7 stay free per product spec §9; nothing should push to the ERP before
  // go-live.
  if (!connection || !connection.wentLiveAt) return new Response();

  const order = payload as unknown as ShopifyOrderPayload;
  await enqueueSyncJob({
    connectionId: connection.id,
    entityType: "order",
    direction: "shopify_to_erp",
    shopifyReferenceId: String(order.id),
    payload: payload,
  });

  return new Response();
};
