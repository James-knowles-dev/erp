import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Mandatory GDPR compliance webhook -- required for public App Store listing.
// See README.md's Product Spec §9. Sent 48 hours after uninstall; unlike webhooks.app.uninstalled
// (which just clears the session), this is the durable-storage cleanup signal -- delete the
// shop's own row here, and once erp_connections/sync_jobs/etc. exist (Milestone 1+), cascade
// or explicitly delete those too rather than leaving orphaned merchant data behind.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`, payload);

  await db.shop.deleteMany({ where: { shopifyDomain: shop } });

  return new Response();
};
