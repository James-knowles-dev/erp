import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { recordOrderSyncUsage } from "./billing.server";

// billing.server.ts imports shopify.server.ts for authenticate/BILLING_PLANS (used by
// requireActiveBillingForGoLive, not exercised here) -- that module wires up a real
// PrismaSessionStorage against the DB at import time, which fails without a real Postgres.
vi.mock("../shopify.server", () => ({
  authenticate: { admin: vi.fn() },
  BILLING_PLANS: { STARTER: "Starter", GROWTH: "Growth", SCALE: "Scale" },
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.ORDER_SYNC_USAGE_PRICE_USD;
  delete process.env.SHOPIFY_BILLING_TEST_MODE; // defaults to test mode
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function activeSubscriptionsResponse(subscriptions: unknown[]) {
  return { json: async () => ({ data: { currentAppInstallation: { activeSubscriptions: subscriptions } } }) } as Response;
}

function usageRecordResponse(userErrors: { field: string[]; message: string }[] = []) {
  return {
    json: async () => ({ data: { appUsageRecordCreate: { userErrors, appUsageRecord: userErrors.length ? null : { id: "rec-1" } } } }),
  } as Response;
}

function mockAdmin(): AdminApiContext {
  return { graphql: vi.fn() } as unknown as AdminApiContext;
}

describe("recordOrderSyncUsage", () => {
  it("is a no-op when ORDER_SYNC_USAGE_PRICE_USD is unset (D1 still unresolved)", async () => {
    const admin = mockAdmin();

    await recordOrderSyncUsage(admin, "job-1", "555");

    expect(admin.graphql).not.toHaveBeenCalled();
  });

  it("is a no-op when the price is explicitly set to 0", async () => {
    process.env.ORDER_SYNC_USAGE_PRICE_USD = "0";
    const admin = mockAdmin();

    await recordOrderSyncUsage(admin, "job-1", "555");

    expect(admin.graphql).not.toHaveBeenCalled();
  });

  it("looks up an active usage subscription but stops there if none exists (e.g. pre-go-live)", async () => {
    process.env.ORDER_SYNC_USAGE_PRICE_USD = "0.10";
    const admin = mockAdmin();
    vi.mocked(admin.graphql).mockResolvedValueOnce(activeSubscriptionsResponse([]));

    await recordOrderSyncUsage(admin, "job-1", "555");

    expect(admin.graphql).toHaveBeenCalledTimes(1); // only the lookup query, no mutation
  });

  it("only matches a subscription whose test flag matches billing test mode", async () => {
    process.env.ORDER_SYNC_USAGE_PRICE_USD = "0.10"; // SHOPIFY_BILLING_TEST_MODE unset -> test mode
    const admin = mockAdmin();
    vi.mocked(admin.graphql).mockResolvedValueOnce(
      activeSubscriptionsResponse([
        { id: "sub-live", test: false, lineItems: [{ id: "li-live", plan: { pricingDetails: { __typename: "AppUsagePricing" } } }] },
      ]),
    );

    await recordOrderSyncUsage(admin, "job-1", "555");

    expect(admin.graphql).toHaveBeenCalledTimes(1); // the non-test subscription doesn't match -> no mutation
  });

  it("creates a usage record with the configured price and an idempotency key derived from the sync job", async () => {
    process.env.ORDER_SYNC_USAGE_PRICE_USD = "0.10";
    const admin = mockAdmin();
    vi.mocked(admin.graphql)
      .mockResolvedValueOnce(
        activeSubscriptionsResponse([
          { id: "sub-1", test: true, lineItems: [{ id: "li-1", plan: { pricingDetails: { __typename: "AppUsagePricing" } } }] },
        ]),
      )
      .mockResolvedValueOnce(usageRecordResponse());

    await recordOrderSyncUsage(admin, "job-1", "555");

    expect(admin.graphql).toHaveBeenCalledTimes(2);
    const [, secondCallArgs] = vi.mocked(admin.graphql).mock.calls[1] as [string, { variables: Record<string, unknown> }];
    expect(secondCallArgs.variables).toMatchObject({
      description: "Order sync: 555",
      price: { amount: 0.1, currencyCode: "USD" },
      subscriptionLineItemId: "li-1",
      idempotencyKey: "job-1",
    });
  });

  it("throws when appUsageRecordCreate returns userErrors", async () => {
    process.env.ORDER_SYNC_USAGE_PRICE_USD = "0.10";
    const admin = mockAdmin();
    vi.mocked(admin.graphql)
      .mockResolvedValueOnce(
        activeSubscriptionsResponse([
          { id: "sub-1", test: true, lineItems: [{ id: "li-1", plan: { pricingDetails: { __typename: "AppUsagePricing" } } }] },
        ]),
      )
      .mockResolvedValueOnce(usageRecordResponse([{ field: ["price"], message: "Invalid price" }]));

    await expect(recordOrderSyncUsage(admin, "job-1", "555")).rejects.toThrow(/Invalid price/);
  });
});
