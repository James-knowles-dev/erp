import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import db from "../db.server";
import { enqueueSyncJob, type EnqueueSyncJobInput } from "./queue.server";

vi.mock("bullmq", () => ({
  Queue: class {
    add = vi.fn();
  },
}));
vi.mock("./redis.server", () => ({ getRedisConnection: vi.fn() }));
vi.mock("../db.server", () => ({
  default: { syncJob: { findFirst: vi.fn(), create: vi.fn() } },
}));

const INPUT: EnqueueSyncJobInput = {
  connectionId: "conn-1",
  entityType: "order",
  direction: "shopify_to_erp",
  shopifyReferenceId: "555",
  payload: { id: 555 },
  mode: "live",
  contentFingerprint: "fingerprint-a",
};

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.2.1",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.syncJob.findFirst).mockResolvedValue(null); // no in-flight duplicate by default
});

describe("enqueueSyncJob", () => {
  it("short-circuits on an in-flight duplicate (queued/processing) without attempting create", async () => {
    vi.mocked(db.syncJob.findFirst).mockResolvedValueOnce({ id: "existing-job" } as never);

    const result = await enqueueSyncJob(INPUT);

    expect(result).toEqual({ enqueued: false, jobId: "existing-job" });
    expect(db.syncJob.create).not.toHaveBeenCalled();
  });

  it("creates a new job and returns enqueued:true on a clean insert", async () => {
    vi.mocked(db.syncJob.create).mockResolvedValue({ id: "new-job" } as never);

    const result = await enqueueSyncJob(INPUT);

    expect(result).toEqual({ enqueued: true, jobId: "new-job" });
    expect(db.syncJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        connectionId: "conn-1",
        entityType: "order",
        shopifyReferenceId: "555",
        contentFingerprint: "fingerprint-a",
        status: "queued",
      }),
    });
  });

  it("catches a P2002 unique-constraint violation and returns the row that won the race instead of throwing", async () => {
    vi.mocked(db.syncJob.create).mockRejectedValueOnce(p2002());
    vi.mocked(db.syncJob.findFirst).mockResolvedValueOnce(null); // the pre-create in-flight check
    vi.mocked(db.syncJob.findFirst).mockResolvedValueOnce({ id: "winner-job" } as never); // post-P2002 lookup

    const result = await enqueueSyncJob(INPUT);

    expect(result).toEqual({ enqueued: false, jobId: "winner-job" });
  });

  it("re-throws a P2002 if, improbably, no row is found on the recovery lookup", async () => {
    vi.mocked(db.syncJob.create).mockRejectedValueOnce(p2002());
    vi.mocked(db.syncJob.findFirst).mockResolvedValueOnce(null);
    vi.mocked(db.syncJob.findFirst).mockResolvedValueOnce(null);

    await expect(enqueueSyncJob(INPUT)).rejects.toThrow("Unique constraint failed");
  });

  it("re-throws non-P2002 errors from create without swallowing them", async () => {
    vi.mocked(db.syncJob.create).mockRejectedValueOnce(new Error("connection lost"));

    await expect(enqueueSyncJob(INPUT)).rejects.toThrow("connection lost");
  });
});
