import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "../db.server";
import { handleCustomerDataRequest, handleCustomerRedact } from "./gdpr.server";

vi.mock("../db.server", () => ({
  default: {
    shop: { findUnique: vi.fn() },
    erpConnection: { findMany: vi.fn() },
    syncJob: { findMany: vi.fn(), update: vi.fn() },
    activityLog: { findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
  },
}));

const SHOP = { id: "shop-1", shopifyDomain: "test-shop.myshopify.com" };
const CONNECTIONS = [{ id: "conn-1" }];

function orderPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 555,
    email: "customer@example.com",
    customer: { id: 42, email: "customer@example.com" },
    billing_address: { first_name: "Bob", last_name: "Norman", address1: "1 Main St", phone: "555-1234" },
    total_price: "99.00",
    line_items: [{ sku: "WIDGET-1", quantity: 2 }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.shop.findUnique).mockResolvedValue(SHOP as never);
  vi.mocked(db.erpConnection.findMany).mockResolvedValue(CONNECTIONS as never);
});

describe("handleCustomerDataRequest", () => {
  it("is a no-op when the shop isn't found", async () => {
    vi.mocked(db.shop.findUnique).mockResolvedValue(null);
    await handleCustomerDataRequest("unknown.myshopify.com", { customer: { id: 42 }, orders_requested: [555] });
    expect(db.syncJob.findMany).not.toHaveBeenCalled();
  });

  it("matches jobs by order id and stages the export in metadata, not message", async () => {
    vi.mocked(db.syncJob.findMany).mockResolvedValue([
      {
        id: "job-1",
        connectionId: "conn-1",
        shopifyReferenceId: "555",
        status: "success",
        erpDocumentRef: "SO-1",
        payload: orderPayload(),
      },
    ] as never);

    await handleCustomerDataRequest(SHOP.shopifyDomain, { customer: { id: 42, email: "customer@example.com" }, orders_requested: [555] });

    expect(db.activityLog.create).toHaveBeenCalledTimes(1);
    const createArgs = vi.mocked(db.activityLog.create).mock.calls[0][0] as unknown as {
      data: { message: string; metadata: unknown[] };
    };
    expect(createArgs.data.message).not.toContain("customer@example.com"); // no PII in free text
    expect(createArgs.data.metadata).toHaveLength(1);
    expect((createArgs.data.metadata[0] as { data: { email: string } }).data.email).toBe("customer@example.com");
  });

  it("matches jobs by customer id alone (no order id in the request)", async () => {
    vi.mocked(db.syncJob.findMany).mockResolvedValue([
      { id: "job-1", connectionId: "conn-1", shopifyReferenceId: "555", status: "success", erpDocumentRef: "SO-1", payload: orderPayload() },
      { id: "job-2", connectionId: "conn-1", shopifyReferenceId: "999", status: "success", erpDocumentRef: "SO-2", payload: orderPayload({ id: 999, customer: { id: 7, email: "other@example.com" }, email: "other@example.com" }) },
    ] as never);

    await handleCustomerDataRequest(SHOP.shopifyDomain, { customer: { id: 42 }, orders_requested: [] });

    const createArgs = vi.mocked(db.activityLog.create).mock.calls[0][0] as unknown as { data: { metadata: unknown[] } };
    expect(createArgs.data.metadata).toHaveLength(1); // only job-1 belongs to customer 42
  });
});

describe("handleCustomerRedact", () => {
  it("is a no-op when the shop isn't found", async () => {
    vi.mocked(db.shop.findUnique).mockResolvedValue(null);
    await handleCustomerRedact("unknown.myshopify.com", { customer: { id: 42 }, orders_to_redact: [555] });
    expect(db.syncJob.findMany).not.toHaveBeenCalled();
  });

  it("redacts PII fields on matching SyncJob.payload but keeps totals/SKUs intact", async () => {
    vi.mocked(db.syncJob.findMany).mockResolvedValue([
      { id: "job-1", connectionId: "conn-1", shopifyReferenceId: "555", payload: orderPayload() },
    ] as never);
    vi.mocked(db.activityLog.findMany).mockResolvedValue([]);

    await handleCustomerRedact(SHOP.shopifyDomain, { customer: { id: 42, email: "customer@example.com" }, orders_to_redact: [555] });

    expect(db.syncJob.update).toHaveBeenCalledTimes(1);
    const updateArgs = vi.mocked(db.syncJob.update).mock.calls[0][0] as {
      data: { payload: Record<string, unknown> };
    };
    const redacted = updateArgs.data.payload as {
      email: string;
      customer: { email: string };
      billing_address: { first_name: string; phone: string };
      total_price: string;
      line_items: unknown[];
    };
    expect(redacted.email).toBe("[REDACTED]");
    expect(redacted.customer.email).toBe("[REDACTED]");
    expect(redacted.billing_address.first_name).toBe("[REDACTED]");
    expect(redacted.billing_address.phone).toBe("[REDACTED]");
    expect(redacted.total_price).toBe("99.00"); // preserved
    expect(redacted.line_items).toEqual([{ sku: "WIDGET-1", quantity: 2 }]); // preserved
  });

  it("scrubs a gdpr_data_request metadata export entry matched by order id, with no email in the redact payload", async () => {
    vi.mocked(db.syncJob.findMany).mockResolvedValue([]); // no direct SyncJob match this time
    vi.mocked(db.activityLog.findMany).mockImplementation((args: unknown) => {
      const where = (args as { where: Record<string, unknown> }).where;
      if ("metadata" in where) {
        return Promise.resolve([
          {
            id: "log-1",
            metadata: [{ shopifyOrderId: "555", syncStatus: "success", erpDocumentRef: "SO-1", data: orderPayload() }],
          },
        ]) as never;
      }
      return Promise.resolve([]) as never; // the free-text message pass, only reached if customerEmail present
    });

    // Note: no customer.email on this payload -- only orders_to_redact, matching by order id.
    await handleCustomerRedact(SHOP.shopifyDomain, { orders_to_redact: [555] });

    expect(db.activityLog.update).toHaveBeenCalledTimes(1);
    const updateArgs = vi.mocked(db.activityLog.update).mock.calls[0][0] as unknown as {
      data: { metadata: Array<{ data: { email: string } }> };
    };
    expect(updateArgs.data.metadata[0].data.email).toBe("[REDACTED]");
  });

  it("leaves non-matching metadata export items untouched", async () => {
    vi.mocked(db.syncJob.findMany).mockResolvedValue([]);
    vi.mocked(db.activityLog.findMany).mockImplementation((args: unknown) => {
      const where = (args as { where: Record<string, unknown> }).where;
      if ("metadata" in where) {
        return Promise.resolve([
          {
            id: "log-1",
            metadata: [
              { shopifyOrderId: "555", syncStatus: "success", erpDocumentRef: "SO-1", data: orderPayload() },
              {
                shopifyOrderId: "999",
                syncStatus: "success",
                erpDocumentRef: "SO-2",
                data: orderPayload({ id: 999, customer: { id: 7, email: "other@example.com" }, email: "other@example.com" }),
              },
            ],
          },
        ]) as never;
      }
      return Promise.resolve([]) as never;
    });

    await handleCustomerRedact(SHOP.shopifyDomain, { orders_to_redact: [555] });

    const updateArgs = vi.mocked(db.activityLog.update).mock.calls[0][0] as unknown as {
      data: { metadata: Array<{ shopifyOrderId: string; data: { email: string } }> };
    };
    const matched = updateArgs.data.metadata.find((item) => item.shopifyOrderId === "555")!;
    const unmatched = updateArgs.data.metadata.find((item) => item.shopifyOrderId === "999")!;
    expect(matched.data.email).toBe("[REDACTED]");
    expect(unmatched.data.email).toBe("other@example.com");
  });

  it("scrubs the customer's email out of free-text ActivityLog messages (e.g. shadow_sync)", async () => {
    vi.mocked(db.syncJob.findMany).mockResolvedValue([]);
    vi.mocked(db.activityLog.findMany).mockImplementation((args: unknown) => {
      const where = (args as { where: Record<string, unknown> }).where;
      if ("metadata" in where) return Promise.resolve([]) as never;
      return Promise.resolve([
        { id: "log-2", message: '[Shadow] Order would sync. Canonical payload: {"customer":{"email":"customer@example.com"}}' },
      ]) as never;
    });

    await handleCustomerRedact(SHOP.shopifyDomain, { customer: { email: "customer@example.com" }, orders_to_redact: [] });

    expect(db.activityLog.update).toHaveBeenCalledWith({
      where: { id: "log-2" },
      data: { message: '[Shadow] Order would sync. Canonical payload: {"customer":{"email":"[REDACTED]"}}' },
    });
  });

  it("does nothing when no data matches the request", async () => {
    vi.mocked(db.syncJob.findMany).mockResolvedValue([]);
    vi.mocked(db.activityLog.findMany).mockResolvedValue([]);

    await handleCustomerRedact(SHOP.shopifyDomain, { customer: { id: 999 }, orders_to_redact: [] });

    expect(db.syncJob.update).not.toHaveBeenCalled();
    expect(db.activityLog.update).not.toHaveBeenCalled();
  });
});
