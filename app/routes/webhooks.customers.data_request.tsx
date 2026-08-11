import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { handleCustomerDataRequest } from "../utils/gdpr.server";

// Mandatory GDPR compliance webhook -- required for public App Store listing.
// See README.md's Product Spec §9. Stages any stored order-linked data for the requested customer
// (SyncJob.payload) per connection in the activity log -- see gdpr.server.ts for why that's the
// interim delivery mechanism.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  await handleCustomerDataRequest(shop, payload);

  return new Response();
};
