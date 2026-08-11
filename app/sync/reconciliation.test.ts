import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import type { ErpConnection } from "@prisma/client";
import { runReconciliationForConnection } from "./reconciliation.server";
import { logActivity } from "./activityLog.server";
import { loadErpCredentials } from "../models/connections.server";
import { createAdapter } from "../adapters/registry.server";
import db from "../db.server";

vi.mock("./activityLog.server", () => ({ logActivity: vi.fn() }));
vi.mock("../models/connections.server", () => ({ loadErpCredentials: vi.fn(), getAuthType: vi.fn() }));
vi.mock("../adapters/registry.server", () => ({ createAdapter: vi.fn(), getAuthType: vi.fn() }));
vi.mock("../db.server", () => ({
  default: {
    syncJob: { findFirst: vi.fn() },
    reconciliationRecord: { create: vi.fn() },
  },
}));

function orderNode(numericId: number, total: string, financialStatus = "PAID") {
  return {
    id: `gid://shopify/Order/${numericId}`,
    displayFinancialStatus: financialStatus,
    currentTotalPriceSet: { shopMoney: { amount: total } },
  };
}

function graphqlPage(
  edges: { node: ReturnType<typeof orderNode> }[],
  hasNextPage: boolean,
  endCursor: string | null,
) {
  return { json: async () => ({ data: { orders: { pageInfo: { hasNextPage, endCursor }, edges } } }) } as Response;
}

function mockAdmin(pages: ReturnType<typeof graphqlPage>[]): AdminApiContext {
  const graphql = vi.fn();
  for (const page of pages) graphql.mockResolvedValueOnce(page);
  return { graphql } as unknown as AdminApiContext;
}

function connection(erpType = "netsuite"): ErpConnection {
  return { id: "conn-1", erpType } as unknown as ErpConnection;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadErpCredentials).mockResolvedValue({ accessToken: "token" });
  vi.mocked(createAdapter).mockReturnValue({
    authenticate: vi.fn().mockResolvedValue({ success: true }),
    getOrderStatus: vi.fn().mockResolvedValue({ total: 10 }),
    // Only the methods reconciliation actually calls are exercised; the rest of ERPAdapter isn't
    // needed for these tests.
  } as never);
  vi.mocked(db.syncJob.findFirst).mockResolvedValue(null);
});

describe("runReconciliationForConnection", () => {
  it("pages through the full reconciliation window, not just the first 250 orders", async () => {
    const admin = mockAdmin([
      graphqlPage([{ node: orderNode(1, "10.00") }], true, "cursor-1"),
      graphqlPage([{ node: orderNode(2, "10.00") }], true, "cursor-2"),
      graphqlPage([{ node: orderNode(3, "10.00") }], false, null),
    ]);
    vi.mocked(db.syncJob.findFirst).mockResolvedValue({
      status: "success",
      erpDocumentRef: "SO-1",
      createdAt: new Date(),
    } as never);

    await runReconciliationForConnection(admin, connection());

    expect(admin.graphql).toHaveBeenCalledTimes(3);
    expect(db.reconciliationRecord.create).toHaveBeenCalledTimes(3);
  });

  it("passes the previous page's endCursor as `after` on the next request", async () => {
    const admin = mockAdmin([
      graphqlPage([{ node: orderNode(1, "10.00") }], true, "cursor-1"),
      graphqlPage([{ node: orderNode(2, "10.00") }], false, null),
    ]);

    await runReconciliationForConnection(admin, connection());

    const secondCallArgs = vi.mocked(admin.graphql).mock.calls[1][1] as { variables: { after: string | null } };
    expect(secondCallArgs.variables.after).toBe("cursor-1");
  });

  it("stops paging at the safety cap rather than looping forever", async () => {
    const admin = {
      graphql: vi.fn().mockImplementation(() => Promise.resolve(graphqlPage([{ node: orderNode(1, "10.00") }], true, "cursor-more"))),
    } as unknown as AdminApiContext;

    await runReconciliationForConnection(admin, connection());

    expect(admin.graphql).toHaveBeenCalledTimes(40); // RECONCILE_MAX_PAGES
  });

  it("records a discrepancy when the ERP total doesn't match Shopify's, and alerts above the 2% threshold", async () => {
    const pages = Array.from({ length: 5 }, (_, i) => graphqlPage([{ node: orderNode(i, "10.00") }], i < 4, i < 4 ? `cursor-${i}` : null));
    const admin = mockAdmin(pages);
    vi.mocked(db.syncJob.findFirst).mockResolvedValue({
      status: "success",
      erpDocumentRef: "SO-1",
      createdAt: new Date(),
    } as never);
    vi.mocked(createAdapter).mockReturnValue({
      authenticate: vi.fn().mockResolvedValue({ success: true }),
      getOrderStatus: vi.fn().mockResolvedValue({ total: 999 }), // every order mismatches
    } as never);

    await runReconciliationForConnection(admin, connection());

    expect(logActivity).toHaveBeenCalledWith(
      "conn-1",
      "reconciliation_alert",
      expect.stringContaining("above the 2% threshold"),
      "error",
    );
  });
});
