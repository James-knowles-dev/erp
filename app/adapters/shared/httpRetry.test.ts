import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithErpRetry } from "./httpRetry.server";

function jsonResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe("fetchWithErpRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns the response as-is on a first-try success", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200));

    const response = await fetchWithErpRetry("https://erp.example.com/orders", {});

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once on 401 with a refreshed Authorization header, then stops even if it 401s again", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(401))
      .mockResolvedValueOnce(jsonResponse(200));
    const onUnauthorized = vi.fn().mockResolvedValue("Bearer fresh-token");

    const response = await fetchWithErpRetry(
      "https://erp.example.com/orders",
      { headers: { Authorization: "Bearer stale-token" } },
      { onUnauthorized },
    );

    expect(response.status).toBe(200);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect((secondCallInit.headers as Record<string, string>).Authorization).toBe("Bearer fresh-token");
  });

  it("does not loop forever if the refreshed token also gets a 401", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(401));
    const onUnauthorized = vi.fn().mockResolvedValue("Bearer fresh-token");

    const response = await fetchWithErpRetry("https://erp.example.com/orders", {}, { onUnauthorized });

    expect(response.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("respects Retry-After on 429 before retrying", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(429, { "Retry-After": "2" }))
      .mockResolvedValueOnce(jsonResponse(200));

    const promise = fetchWithErpRetry("https://erp.example.com/orders", {});
    await vi.advanceTimersByTimeAsync(2000);
    const response = await promise;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a network-level failure with exponential backoff", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(jsonResponse(200));

    const promise = fetchWithErpRetry("https://erp.example.com/orders", {});
    await vi.advanceTimersByTimeAsync(5000);
    const response = await promise;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxAttempts on repeated 429s", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(429));

    const promise = fetchWithErpRetry("https://erp.example.com/orders", {}, { maxAttempts: 2 });
    await vi.advanceTimersByTimeAsync(5000);
    const response = await promise;

    expect(response.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("respects Retry-After given as an HTTP-date, not just seconds", async () => {
    const retryAt = new Date(Date.now() + 3000).toUTCString();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(429, { "Retry-After": retryAt }))
      .mockResolvedValueOnce(jsonResponse(200));

    const promise = fetchWithErpRetry("https://erp.example.com/orders", {});
    await vi.advanceTimersByTimeAsync(3000);
    const response = await promise;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns a 401 as-is on the first attempt when no onUnauthorized handler is given (Sage 300/Intacct's case)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(401));

    const response = await fetchWithErpRetry("https://erp.example.com/orders", {});

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
