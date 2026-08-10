import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate, BILLING_PLANS } from "../shopify.server";

// Not called from anywhere yet in Milestone 0 -- these are the two hooks Milestone 3's wizard
// step 8 ("go live") will call, built now so the billing plumbing (plan config in
// shopify.server.ts) has real callers to verify against. Per erp-connector-dev-spec.md §13,
// wizard steps 1-7 must stay free; billing only starts here, at the go-live action.

// Call from the wizard's "go live" action once it exists (Milestone 3). Redirects the merchant
// to approve a subscription if they don't have one yet.
export async function requireActiveBillingForGoLive(request: LoaderFunctionArgs["request"]) {
  const { billing } = await authenticate.admin(request);

  return billing.require({
    plans: Object.values(BILLING_PLANS),
    isTest: process.env.NODE_ENV !== "production",
    onFailure: async () =>
      billing.request({
        plan: BILLING_PLANS.STARTER, // PLACEHOLDER default -- real tier selection UI is Milestone 3+ scope
        isTest: process.env.NODE_ENV !== "production",
      }),
  });
}

// Call once per synced order, from the sync worker (Milestone 3+), per
// erp-connector-dev-spec.md §13: "usage records submitted as orders sync."
export async function recordOrderSyncUsage(
  request: LoaderFunctionArgs["request"],
  orderId: string,
) {
  const { billing } = await authenticate.admin(request);

  return billing.createUsageRecord({
    description: `Order sync: ${orderId}`,
    price: { amount: 0, currencyCode: "USD" }, // PLACEHOLDER per-order price, pending D1
    isTest: process.env.NODE_ENV !== "production",
  });
}
