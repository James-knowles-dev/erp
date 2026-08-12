import type { LoaderFunctionArgs } from "@remix-run/node";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
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

// Called once per synced order, from the sync worker (app/sync/worker.server.ts), per README.md's
// Development Spec §13: "usage records submitted as orders sync." Takes AdminApiContext rather
// than a request -- the worker runs as a background job with no live HTTP request to authenticate,
// so it gets its admin context from unauthenticated.admin(shop) instead of authenticate.admin
// (see requireActiveBillingForGoLive above for the request-scoped equivalent used by the wizard).
//
// Per-order pricing (decision D1) is still unresolved, so this stays a deliberate no-op --
// ORDER_SYNC_USAGE_PRICE_USD defaults unset/0 -- until an operator sets a real price; the plumbing
// below is real, the number isn't, until D1 is decided.
//
// UNVERIFIED (matches this app's D4 adapter caveat in README.md): the appUsageRecordCreate
// mutation shape and idempotencyKey argument below are built from Shopify's documented Billing
// API, not exercised against a live store with an active usage subscription. Smoke-test against a
// real dev-store subscription before relying on this in production.
const ACTIVE_USAGE_LINE_ITEM_QUERY = `#graphql
  query ActiveUsageSubscriptionLineItem {
    currentAppInstallation {
      activeSubscriptions {
        id
        test
        lineItems {
          id
          plan { pricingDetails { __typename ... on AppUsagePricing { balanceUsed { amount } } } }
        }
      }
    }
  }
`;

interface ActiveUsageLineItemResponse {
  data: {
    currentAppInstallation: {
      activeSubscriptions: {
        id: string;
        test: boolean;
        lineItems: { id: string; plan: { pricingDetails: { __typename: string } } }[];
      }[];
    };
  };
}

async function findActiveUsageLineItemId(admin: AdminApiContext, isTest: boolean): Promise<string | null> {
  const response = await admin.graphql(ACTIVE_USAGE_LINE_ITEM_QUERY);
  const { data } = (await response.json()) as ActiveUsageLineItemResponse;
  for (const subscription of data.currentAppInstallation.activeSubscriptions) {
    if (subscription.test !== isTest) continue;
    const usageLineItem = subscription.lineItems.find((li) => li.plan.pricingDetails.__typename === "AppUsagePricing");
    if (usageLineItem) return usageLineItem.id;
  }
  return null;
}

const CREATE_USAGE_RECORD_MUTATION = `#graphql
  mutation AppUsageRecordCreate($description: String!, $price: MoneyInput!, $subscriptionLineItemId: ID!, $idempotencyKey: String) {
    appUsageRecordCreate(
      description: $description
      price: $price
      subscriptionLineItemId: $subscriptionLineItemId
      idempotencyKey: $idempotencyKey
    ) {
      userErrors { field message }
      appUsageRecord { id }
    }
  }
`;

interface CreateUsageRecordResponse {
  data: {
    appUsageRecordCreate: {
      userErrors: { field: string[]; message: string }[];
      appUsageRecord: { id: string } | null;
    };
  };
}

export async function recordOrderSyncUsage(
  admin: AdminApiContext,
  syncJobId: string,
  orderId: string,
): Promise<void> {
  const priceAmount = Number(process.env.ORDER_SYNC_USAGE_PRICE_USD ?? 0);
  if (!(priceAmount > 0)) return;

  const subscriptionLineItemId = await findActiveUsageLineItemId(admin, isTestBilling());
  if (!subscriptionLineItemId) return; // no active usage subscription yet (e.g. still pre-go-live)

  const response = await admin.graphql(CREATE_USAGE_RECORD_MUTATION, {
    variables: {
      description: `Order sync: ${orderId}`,
      price: { amount: priceAmount, currencyCode: "USD" },
      subscriptionLineItemId,
      // Safe to call again if a retry re-runs this after the first attempt actually succeeded --
      // Shopify dedupes by this key rather than creating a second usage record for the same order.
      idempotencyKey: syncJobId,
    },
  });
  const { data } = (await response.json()) as CreateUsageRecordResponse;
  if (data.appUsageRecordCreate.userErrors.length > 0) {
    throw new Error(`appUsageRecordCreate failed: ${JSON.stringify(data.appUsageRecordCreate.userErrors)}`);
  }
}
