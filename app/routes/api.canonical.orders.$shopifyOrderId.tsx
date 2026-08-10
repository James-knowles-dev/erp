import type { LoaderFunctionArgs } from "@remix-run/node";
import db from "../db.server";
import { requireApiKeyConnection } from "../utils/apiKey.server";
import { shopifyOrderToCanonical, type ShopifyOrderPayload } from "../sync/shopifyToCanonical";

// Product spec §7.7: "API access to the canonical model -- so an agency building something
// bespoke on top isn't fighting the ERP's native API directly, but working against the same
// clean internal model the app itself uses." Reconstructed on demand from the stored webhook
// payload (sync_jobs.payload) rather than a separately persisted canonical record -- there's
// only ever one source of truth for "what Shopify sent us," and rebuilding from it means this
// can never drift from what shopifyToCanonical.ts actually produces.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const connection = await requireApiKeyConnection(request);
  const shopifyOrderId = params.shopifyOrderId!;

  const syncJob = await db.syncJob.findFirst({
    where: { connectionId: connection.id, entityType: "order", shopifyReferenceId: shopifyOrderId },
    orderBy: { createdAt: "desc" },
  });

  if (!syncJob) {
    return Response.json({ error: "No sync record found for this order." }, { status: 404 });
  }

  const canonicalOrder = shopifyOrderToCanonical(
    connection.shopId,
    syncJob.payload as unknown as ShopifyOrderPayload,
  );

  return Response.json({
    order: canonicalOrder,
    syncStatus: syncJob.status,
    erpDocumentRef: syncJob.erpDocumentRef,
  });
};
