import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import db from "../db.server";
import { enqueueSyncJob } from "./queue.server";

// Real-DB counterpart to queue.test.ts's mocked P2002 test (erp-connector-fixes-spec.md F4
// follow-up): that test proves enqueueSyncJob's application-level reaction to a unique-constraint
// violation is correct; this proves the constraint itself -- sync_jobs_dedup_fingerprint_key --
// actually blocks two genuinely concurrent identical webhook deliveries at the database level,
// which nothing short of a real Postgres under real concurrency can demonstrate. See
// docker-compose.test.yml / vitest.integration.config.ts for how this suite is run.
//
// BullMQ/Redis aren't under test here -- mocked out exactly like queue.test.ts, so this only needs
// a real Postgres, not a real Redis too.
vi.mock("bullmq", () => ({
  Queue: class {
    add = vi.fn();
  },
}));
vi.mock("./redis.server", () => ({ getRedisConnection: vi.fn() }));

describe("enqueueSyncJob against a real Postgres", () => {
  const shopId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();

  beforeAll(async () => {
    await db.shop.create({
      data: {
        id: shopId,
        shopifyDomain: `dedup-test-${shopId}.myshopify.com`,
        accessTokenEncrypted: "not-a-real-token",
        installedAt: new Date(),
        planTier: "free",
      },
    });
    await db.erpConnection.create({
      data: { id: connectionId, shopId, erpType: "netsuite", environment: "sandbox", status: "active" },
    });
  });

  afterAll(async () => {
    // Cascades to SyncJob rows created below (Shop -> ErpConnection -> SyncJob, onDelete: Cascade).
    await db.shop.delete({ where: { id: shopId } });
  });

  it("dedupes two genuinely concurrent deliveries of the identical webhook to exactly one SyncJob", async () => {
    const input = {
      connectionId,
      entityType: "order" as const,
      direction: "shopify_to_erp" as const,
      shopifyReferenceId: "race-order-1",
      payload: { id: "race-order-1" },
      mode: "live" as const,
      contentFingerprint: "fingerprint-race-1",
    };

    const [first, second] = await Promise.all([enqueueSyncJob(input), enqueueSyncJob(input)]);

    const enqueuedCount = [first, second].filter((r) => r.enqueued).length;
    expect(enqueuedCount).toBe(1);
    expect(first.jobId).toBe(second.jobId); // both resolved to the same winning row

    const rows = await db.syncJob.findMany({
      where: { connectionId, shopifyReferenceId: "race-order-1", contentFingerprint: "fingerprint-race-1" },
    });
    expect(rows).toHaveLength(1);
  });

  it("does not dedupe a genuinely different event for the same order (different contentFingerprint)", async () => {
    const base = {
      connectionId,
      entityType: "order" as const,
      direction: "shopify_to_erp" as const,
      shopifyReferenceId: "race-order-2",
      payload: { id: "race-order-2" },
      mode: "live" as const,
    };

    const first = await enqueueSyncJob({ ...base, contentFingerprint: "fingerprint-a" });
    const second = await enqueueSyncJob({ ...base, contentFingerprint: "fingerprint-b" });

    expect(first.enqueued).toBe(true);
    expect(second.enqueued).toBe(true);
    expect(first.jobId).not.toBe(second.jobId);

    const rows = await db.syncJob.findMany({ where: { connectionId, shopifyReferenceId: "race-order-2" } });
    expect(rows).toHaveLength(2);
  });
});
