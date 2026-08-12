import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "../db.server";
import { decrypt } from "../utils/encryption.server";
import { sendAlertEmail } from "../utils/email.server";
import { processDelivery } from "./webhookDispatch.server";
import type { WebhookEventType } from "./webhookEventTypes";

// webhookDispatch.server.ts creates a real BullMQ Worker (and thus a Redis connection) as an
// import-time side effect -- these mocks let the module load without either, so processDelivery
// (the actual per-channel-kind delivery logic) can be exercised directly.
vi.mock("bullmq", () => ({
  Worker: class {
    on = vi.fn();
  },
  Queue: class {},
}));
vi.mock("./redis.server", () => ({ getRedisConnection: vi.fn() }));
vi.mock("../db.server", () => ({
  default: { webhookSubscription: { findUnique: vi.fn() } },
}));
vi.mock("../utils/encryption.server", () => ({ decrypt: vi.fn() }));
vi.mock("../utils/email.server", () => ({ sendAlertEmail: vi.fn() }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
});

function job(overrides: Partial<{ subscriptionId: string; eventType: WebhookEventType; payload: Record<string, unknown> }> = {}) {
  return {
    data: {
      subscriptionId: "sub-1",
      eventType: "sync_failed" as WebhookEventType,
      payload: { shopifyOrderId: "555", error: "boom" },
      ...overrides,
    },
  };
}

describe("processDelivery", () => {
  it("is a no-op when the subscription was deleted since the event fired", async () => {
    vi.mocked(db.webhookSubscription.findUnique).mockResolvedValue(null);

    await processDelivery(job());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("generic: POSTs a signed JSON envelope with the raw payload", async () => {
    vi.mocked(db.webhookSubscription.findUnique).mockResolvedValue({
      id: "sub-1",
      url: "https://agency.example.com/hook",
      channelKind: "generic",
      secretEncrypted: "enc",
    } as never);
    vi.mocked(decrypt).mockReturnValue("plain-secret");

    await processDelivery(job());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://agency.example.com/hook");
    expect(init.headers).toMatchObject({ "X-ERP-Connector-Event": "sync_failed" });
    const body = JSON.parse(init.body as string);
    expect(body.payload).toEqual({ shopifyOrderId: "555", error: "boom" });
  });

  it("generic: throws when the destination responds with a non-2xx status (so BullMQ retries)", async () => {
    vi.mocked(db.webhookSubscription.findUnique).mockResolvedValue({
      id: "sub-1",
      url: "https://agency.example.com/hook",
      channelKind: "generic",
      secretEncrypted: "enc",
    } as never);
    vi.mocked(decrypt).mockReturnValue("plain-secret");
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(processDelivery(job())).rejects.toThrow(/failed: 500/);
  });

  it("slack: POSTs a plain {text} body with no signature headers", async () => {
    vi.mocked(db.webhookSubscription.findUnique).mockResolvedValue({
      id: "sub-1",
      url: "https://hooks.slack.com/services/xyz",
      channelKind: "slack",
      secretEncrypted: "enc",
    } as never);

    await processDelivery(job());

    expect(decrypt).not.toHaveBeenCalled(); // slack delivery never needs the signing secret
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.com/services/xyz");
    const body = JSON.parse(init.body as string);
    expect(body.text).toContain("ERP sync failed");
    expect(body.text).toContain("555");
  });

  it("email: sends via SMTP instead of fetch, using 'url' as the destination address", async () => {
    vi.mocked(db.webhookSubscription.findUnique).mockResolvedValue({
      id: "sub-1",
      url: "ops@agency.example.com",
      channelKind: "email",
      secretEncrypted: "enc",
    } as never);

    await processDelivery(job({ eventType: "reconciliation_alert", payload: { message: "12 of 100 orders mismatched" } }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendAlertEmail).toHaveBeenCalledWith(
      "ops@agency.example.com",
      expect.stringContaining("Reconciliation discrepancy"),
      "12 of 100 orders mismatched",
    );
  });
});
