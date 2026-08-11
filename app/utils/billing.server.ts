import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate, BILLING_PLANS } from "../shopify.server";

// Per README.md's Development Spec §13, wizard steps 1-7 must stay free; billing only starts at the
// go-live action (Milestone 3, wizard step 8).

// Whether to charge for real. Deliberately NOT keyed off NODE_ENV=production -- that's set on
// Railway for Node build-optimization reasons, unrelated to whether this app is being used by
// real paying merchants yet. Defaults to test mode (safe) unless explicitly turned off; flip to
// "false" only once real pricing (decision D1) is resolved and this is meant to charge for real.
function isTestBilling(): boolean {
  return process.env.SHOPIFY_BILLING_TEST_MODE !== "false";
}

// Redirects the merchant to approve a subscription if they don't have one yet. returnUrl brings
// them back to the wizard step that called this, not the app's default landing page.
export async function requireActiveBillingForGoLive(
  request: LoaderFunctionArgs["request"],
  returnUrl: string,
) {
  const { billing } = await authenticate.admin(request);

  return billing.require({
    plans: Object.values(BILLING_PLANS),
    isTest: isTestBilling(),
    onFailure: async () =>
      billing.request({
        plan: BILLING_PLANS.STARTER, // PLACEHOLDER default -- real tier selection UI is a follow-up
        isTest: isTestBilling(),
        returnUrl,
      }),
  });
}

// Call once per synced order, from the sync worker, per README.md's Development Spec §13: "usage
// records submitted as orders sync." Not yet called from worker.server.ts -- per-order pricing
// (decision D1) is still a placeholder, so wiring this in now would submit meaningless $0 usage
// records rather than nothing at all.
export async function recordOrderSyncUsage(
  request: LoaderFunctionArgs["request"],
  orderId: string,
) {
  const { billing } = await authenticate.admin(request);

  return billing.createUsageRecord({
    description: `Order sync: ${orderId}`,
    price: { amount: 0, currencyCode: "USD" }, // PLACEHOLDER per-order price, pending D1
    isTest: isTestBilling(),
  });
}
