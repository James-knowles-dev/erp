import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import db from "../db.server";
import { generateApiKey, requireApiKeyConnection, setApiKey } from "./apiKey.server";

vi.mock("../db.server", () => ({
  default: {
    erpConnection: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateApiKey", () => {
  it("is prefixed so a leaked key is recognizable, and unique per call", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.startsWith("erpc_")).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("requireApiKeyConnection", () => {
  it("throws 401 when the Authorization header is missing", async () => {
    const request = new Request("https://example.com", { headers: {} });
    await expect(requireApiKeyConnection(request)).rejects.toMatchObject({ status: 401 });
  });

  it("throws 401 when the Authorization header isn't a Bearer token", async () => {
    const request = new Request("https://example.com", { headers: { authorization: "Basic abc123" } });
    await expect(requireApiKeyConnection(request)).rejects.toMatchObject({ status: 401 });
  });

  it("throws 401 when the key doesn't match any stored hash", async () => {
    vi.mocked(db.erpConnection.findUnique).mockResolvedValue(null);
    const request = new Request("https://example.com", { headers: { authorization: "Bearer erpc_bogus" } });
    await expect(requireApiKeyConnection(request)).rejects.toMatchObject({ status: 401 });
  });

  it("returns the connection when the key's hash matches a stored connection", async () => {
    const key = "erpc_realkey";
    const connection = { id: "conn-1", apiKeyHash: hashKey(key) };
    vi.mocked(db.erpConnection.findUnique).mockResolvedValue(connection as never);

    const request = new Request("https://example.com", { headers: { authorization: `Bearer ${key}` } });
    const result = await requireApiKeyConnection(request);

    expect(result).toBe(connection);
    expect(db.erpConnection.findUnique).toHaveBeenCalledWith({ where: { apiKeyHash: hashKey(key) } });
  });
});

describe("setApiKey", () => {
  it("stores the SHA-256 hash of the key, never the key itself", async () => {
    await setApiKey("conn-1", "erpc_plaintext");
    expect(db.erpConnection.update).toHaveBeenCalledWith({
      where: { id: "conn-1" },
      data: { apiKeyHash: hashKey("erpc_plaintext") },
    });
  });
});
