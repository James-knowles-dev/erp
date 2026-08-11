import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import db from "../db.server";
import { getConnection, getFieldMappings, loadErpCredentials } from "../models/connections.server";
import { createAdapter, getAuthType, getDefaultFieldMappings } from "../adapters/registry.server";
import { logActivity } from "./activityLog.server";
import { dispatchEvent } from "./webhookDispatch.server";
import { handleJobFailure, processJob } from "./worker.server";

// worker.server.ts creates a real BullMQ Worker (and thus a Redis connection) as an import-time
// side effect -- these mocks let the module load without either, so processJob/handleJobFailure
// (the actual logic) can be exercised directly.
vi.mock("bullmq", () => ({
  Worker: class {
    on = vi.fn();
  },
}));
vi.mock("./redis.server", () => ({ getRedisConnection: vi.fn() }));

vi.mock("../db.server", () => ({
  default: {
    syncJob: { findUniqueOrThrow: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    erpConnection: { update: vi.fn() },
  },
}));
vi.mock("../models/connections.server", () => ({
  getConnection: vi.fn(),
  getFieldMappings: vi.fn(),
  loadErpCredentials: vi.fn(),
}));
vi.mock("../adapters/registry.server", () => ({
  createAdapter: vi.fn(),
  getAuthType: vi.fn(),
  getDefaultFieldMappings: vi.fn(),
}));
vi.mock("./activityLog.server", () => ({ logActivity: vi.fn() }));
vi.mock("./webhookDispatch.server", () => ({ dispatchEvent: vi.fn() }));

const CONNECTION = { id: "conn-1", shopId: "shop-1", erpType: "netsuite", status: "active" };

function makeJob(overrides: Partial<Job<{ syncJobId: string }>> = {}): Job<{ syncJobId: string }> {
  return { data: { syncJobId: "job-1" }, attemptsMade: 1, opts: { attempts: 5 }, ...overrides } as Job<{
    syncJobId: string;
  }>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getConnection).mockResolvedValue(CONNECTION as never);
  vi.mocked(getFieldMappings).mockResolvedValue([]);
  vi.mocked(getDefaultFieldMappings).mockReturnValue({ mappings: [] } as never);
  vi.mocked(loadErpCredentials).mockResolvedValue({ token: "abc" });
  vi.mocked(getAuthType).mockReturnValue("oauth2");
  vi.mocked(db.syncJob.update).mockResolvedValue({} as never);
  vi.mocked(db.erpConnection.update).mockResolvedValue({} as never);
  vi.mocked(db.syncJob.findFirst).mockResolvedValue(null); // no pre-existing successful sync by default
});

const CANONICAL_ORDER_PAYLOAD = {
  id: 555,
  created_at: "2026-07-01T00:00:00Z",
  currency: "USD",
  customer: { id: 1, email: "customer@example.com" },
  billing_address: null,
  shipping_address: null,
  line_items: [{ sku: "WIDGET-1", quantity: 1, price: "10.00", taxable: true, fulfillable_quantity: 1, fulfillment_status: null }],
  tax_lines: [],
  shipping_lines: [],
  financial_status: "paid",
  fulfillment_status: null,
  fulfillments: [],
};

describe("processJob", () => {
  it("shadow mode: logs the canonical order and marks success without calling the adapter", async () => {
    vi.mocked(db.syncJob.findUniqueOrThrow).mockResolvedValue({
      id: "job-1",
      connectionId: "conn-1",
      entityType: "order",
      mode: "shadow",
      shopifyReferenceId: "555",
      payload: CANONICAL_ORDER_PAYLOAD,
    } as never);
    const adapter = { authenticate: vi.fn(), pushOrder: vi.fn() };
    vi.mocked(createAdapter).mockReturnValue(adapter as never);

    await processJob(makeJob());

    expect(adapter.pushOrder).not.toHaveBeenCalled();
    expect(adapter.authenticate).not.toHaveBeenCalled();
    expect(db.syncJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "success", completedAt: expect.any(Date) },
    });
    expect(logActivity).toHaveBeenCalledWith("conn-1", "shadow_sync", expect.stringContaining("Shadow"));
  });

  it("adopts an already-successful sync's result instead of pushing again (defense-in-depth dedup)", async () => {
    vi.mocked(db.syncJob.findUniqueOrThrow).mockResolvedValue({
      id: "job-2",
      connectionId: "conn-1",
      entityType: "order",
      mode: "live",
      shopifyReferenceId: "555",
      payload: CANONICAL_ORDER_PAYLOAD,
    } as never);
    vi.mocked(db.syncJob.findFirst).mockResolvedValue({ id: "job-1", erpDocumentRef: "SO-100" } as never);
    const adapter = { authenticate: vi.fn(), pushOrder: vi.fn() };
    vi.mocked(createAdapter).mockReturnValue(adapter as never);

    await processJob(makeJob({ data: { syncJobId: "job-2" } }));

    expect(adapter.pushOrder).not.toHaveBeenCalled();
    expect(db.syncJob.update).toHaveBeenCalledWith({
      where: { id: "job-2" },
      data: { status: "success", erpDocumentRef: "SO-100", completedAt: expect.any(Date) },
    });
  });

  it("live path: authenticates, pushes the order, and records the returned document ref", async () => {
    vi.mocked(db.syncJob.findUniqueOrThrow).mockResolvedValue({
      id: "job-3",
      connectionId: "conn-1",
      entityType: "order",
      mode: "live",
      shopifyReferenceId: "555",
      payload: CANONICAL_ORDER_PAYLOAD,
    } as never);
    const adapter = {
      authenticate: vi.fn().mockResolvedValue({ success: true }),
      pushOrder: vi.fn().mockResolvedValue({ documentType: "SalesOrder", documentId: "SO-200" }),
    };
    vi.mocked(createAdapter).mockReturnValue(adapter as never);

    await processJob(makeJob({ data: { syncJobId: "job-3" } }));

    expect(adapter.authenticate).toHaveBeenCalledTimes(1);
    expect(adapter.pushOrder).toHaveBeenCalledTimes(1);
    expect(db.syncJob.update).toHaveBeenCalledWith({
      where: { id: "job-3" },
      data: { status: "success", erpDocumentRef: "SO-200", completedAt: expect.any(Date) },
    });
    expect(db.erpConnection.update).toHaveBeenCalledWith({
      where: { id: "conn-1" },
      data: { lastSuccessfulSyncAt: expect.any(Date) },
    });
    expect(dispatchEvent).toHaveBeenCalledWith("conn-1", "order_synced", expect.objectContaining({ erpDocumentId: "SO-200" }));
  });

  it("throws (refuses to process) when the connection is disabled", async () => {
    vi.mocked(db.syncJob.findUniqueOrThrow).mockResolvedValue({
      id: "job-4",
      connectionId: "conn-1",
      entityType: "order",
      mode: "live",
      shopifyReferenceId: "555",
      payload: CANONICAL_ORDER_PAYLOAD,
    } as never);
    vi.mocked(getConnection).mockResolvedValue({ ...CONNECTION, status: "disabled" } as never);

    await expect(processJob(makeJob({ data: { syncJobId: "job-4" } }))).rejects.toThrow(/disabled or missing/);
  });
});

describe("handleJobFailure", () => {
  it("is a no-op when job is undefined (BullMQ can call 'failed' without a job)", async () => {
    await handleJobFailure(undefined, new Error("boom"));
    expect(db.syncJob.update).not.toHaveBeenCalled();
  });

  it("marks the job 'failed' (not dead_letter) and doesn't dispatch when a retry remains", async () => {
    vi.mocked(db.syncJob.update).mockResolvedValue({ connectionId: "conn-1", shopifyReferenceId: "555" } as never);

    await handleJobFailure(makeJob({ attemptsMade: 2, opts: { attempts: 5 } }), new Error("transient"));

    expect(db.syncJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "failed", lastError: "transient" },
    });
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(logActivity).toHaveBeenCalledWith("conn-1", "sync_failed", expect.any(String), "warning");
  });

  it("marks the job 'dead_letter' and dispatches sync_failed once attempts are exhausted", async () => {
    vi.mocked(db.syncJob.update).mockResolvedValue({ connectionId: "conn-1", shopifyReferenceId: "555" } as never);

    await handleJobFailure(makeJob({ attemptsMade: 5, opts: { attempts: 5 } }), new Error("permanent"));

    expect(db.syncJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "dead_letter", lastError: "permanent" },
    });
    expect(dispatchEvent).toHaveBeenCalledWith("conn-1", "sync_failed", { shopifyOrderId: "555", error: "permanent" });
    expect(logActivity).toHaveBeenCalledWith("conn-1", "sync_dead_letter", expect.any(String), "error");
  });
});
