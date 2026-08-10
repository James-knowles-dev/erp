import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// Mandatory GDPR compliance webhook -- required for public App Store listing.
// See erp-connector-spec.md §9. No customer PII is stored yet as of Milestone 0; once
// sync_jobs/reconciliation_records hold customer data (Milestone 3+), this handler needs to
// actually delete or anonymize that customer's records rather than just acknowledging receipt.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`, payload);

  return new Response();
};
