import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { handleCustomerRedact } from "../utils/gdpr.server";

// Mandatory GDPR compliance webhook -- required for public App Store listing.
// See erp-connector-spec.md §9. Anonymizes the requested customer's data inside stored SyncJob
// payloads and activity log messages -- see gdpr.server.ts.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  await handleCustomerRedact(shop, payload);

  return new Response();
};
