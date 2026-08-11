import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { GraphQLOrderNode } from "./preflight.server";
import { enqueueSyncJob } from "./queue.server";
import { logActivity } from "./activityLog.server";
import { runBackfill } from "./backfill.server";

vi.mock("./queue.server", () => ({ enqueueSyncJob: vi.fn() }));
vi.mock("./activityLog.server", () => ({ logActivity: vi.fn() }));

function node(numericId: number): GraphQLOrderNode {
  return {
    id: `gid://shopify/Order/${numericId}`,
    name: `#${numericId}`,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    currencyCode: "USD",
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    customer: { id: "gid://shopify/Customer/1", email: "customer@example.com" },
    email: "customer@example.com",
    totalDiscountsSet: { shopMoney: { amount: "0.00" } },
    taxLines: [],
    lineItems: { edges: [{ node: { sku: "WIDGET-1", quantity: 1, taxable: true, fulfillableQuantity: 1, discountedUnitPriceSet: { shopMoney: { amount: "10.00" } } } }] },
  };
}

function graphqlResponse(edges: { node: GraphQLOrderNode }[], hasNextPage: boolean, endCursor: string | null) {
  return { json: async () => ({ data: { orders: { pageInfo: { hasNextPage, endCursor }, edges } } }) } as Response;
}

function mockAdmin(pages: ReturnType<typeof graphqlResponse>[]): AdminApiContext {
  const graphql = vi.fn();
  for (const page of pages) graphql.mockResolvedValueOnce(page);
  return { graphql } as unknown as AdminApiContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(enqueueSyncJob).mockResolvedValue({ enqueued: true, jobId: "job-x" });
});

describe("runBackfill", () => {
  it("returns zero counts without querying when the window is 'none'", async () => {
    const admin = mockAdmin([]);
    const result = await runBackfill(admin, "conn-1", "none");
    expect(result).toEqual({ enqueued: 0, totalFound: 0, truncated: false });
    expect(admin.graphql).not.toHaveBeenCalled();
  });

  it("enqueues every order across multiple pages, not just the first", async () => {
    const admin = mockAdmin([
      graphqlResponse([{ node: node(1) }, { node: node(2) }], true, "cursor-1"),
      graphqlResponse([{ node: node(3) }], true, "cursor-2"),
      graphqlResponse([{ node: node(4) }], false, null),
    ]);

    const result = await runBackfill(admin, "conn-1", "30d");

    expect(result).toEqual({ enqueued: 4, totalFound: 4, truncated: false });
    expect(admin.graphql).toHaveBeenCalledTimes(3);
    expect(enqueueSyncJob).toHaveBeenCalledTimes(4);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("passes the previous page's endCursor as `after` on the next request", async () => {
    const admin = mockAdmin([
      graphqlResponse([{ node: node(1) }], true, "cursor-1"),
      graphqlResponse([{ node: node(2) }], false, null),
    ]);

    await runBackfill(admin, "conn-1", "30d");

    const secondCallArgs = vi.mocked(admin.graphql).mock.calls[1][1] as { variables: { after: string | null } };
    expect(secondCallArgs.variables.after).toBe("cursor-1");
  });

  it("only counts a job as enqueued when enqueueSyncJob reports enqueued:true (dedup doesn't double-count)", async () => {
    vi.mocked(enqueueSyncJob)
      .mockResolvedValueOnce({ enqueued: true, jobId: "job-1" })
      .mockResolvedValueOnce({ enqueued: false, jobId: "job-1" }); // duplicate, already existed

    const admin = mockAdmin([graphqlResponse([{ node: node(1) }, { node: node(1) }], false, null)]);
    const result = await runBackfill(admin, "conn-1", "30d");

    expect(result).toEqual({ enqueued: 1, totalFound: 2, truncated: false });
  });

  it("stops at the safety cap, reports truncated:true, and logs a warning", async () => {
    // hasNextPage:true forever -- exercises the MAX_PAGES backstop rather than a real end-of-data page.
    const admin = { graphql: vi.fn().mockImplementation(() => Promise.resolve(graphqlResponse([{ node: node(1) }], true, "cursor-more"))) } as unknown as AdminApiContext;

    const result = await runBackfill(admin, "conn-1", "90d");

    expect(result.truncated).toBe(true);
    expect(result.enqueued).toBe(result.totalFound); // every page's single order still got enqueued
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith("conn-1", "backfill_truncated", expect.stringContaining("safety cap"), "warning");
  });
});
