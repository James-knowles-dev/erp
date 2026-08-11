import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import db from "../db.server";
import { encrypt } from "./encryption.server";
import { reencryptStaleCredentials } from "./reencryptCredentials.server";

vi.mock("../db.server", () => ({
  default: {
    shop: { findMany: vi.fn(), update: vi.fn() },
    erpConnection: { findMany: vi.fn(), update: vi.fn() },
  },
}));

const KEY_V1 = crypto.randomBytes(32).toString("base64");

describe("reencryptStaleCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENCRYPTION_MASTER_KEY = KEY_V1;
    delete process.env.ENCRYPTION_MASTER_KEY_V2;
    delete process.env.ENCRYPTION_KEY_VERSION;
  });

  it("re-encrypts every shop and connection row, preserving plaintext", async () => {
    const shopCiphertext = encrypt("shop-access-token");
    const connectionCiphertext = encrypt(JSON.stringify({ clientId: "abc" }));

    vi.mocked(db.shop.findMany).mockResolvedValue([{ id: "shop-1", accessTokenEncrypted: shopCiphertext }] as never);
    vi.mocked(db.erpConnection.findMany).mockResolvedValue([
      { id: "conn-1", credentialsEncrypted: connectionCiphertext },
    ] as never);

    const result = await reencryptStaleCredentials();

    expect(result).toEqual({ shopsUpdated: 1, connectionsUpdated: 1, errors: [] });
    expect(db.shop.update).toHaveBeenCalledTimes(1);
    expect(db.erpConnection.update).toHaveBeenCalledTimes(1);

    const shopUpdateData = vi.mocked(db.shop.update).mock.calls[0][0].data as { accessTokenEncrypted: string };
    const connectionUpdateData = vi.mocked(db.erpConnection.update).mock.calls[0][0].data as {
      credentialsEncrypted: string;
    };
    expect(shopUpdateData.accessTokenEncrypted).not.toBe(shopCiphertext); // fresh iv -> different bytes
    expect(connectionUpdateData.credentialsEncrypted).not.toBe(connectionCiphertext);
  });

  it("skips connections with null credentialsEncrypted (never queries them for re-encryption)", async () => {
    vi.mocked(db.shop.findMany).mockResolvedValue([]);
    vi.mocked(db.erpConnection.findMany).mockResolvedValue([]);

    await reencryptStaleCredentials();

    const [findManyArgs] = vi.mocked(db.erpConnection.findMany).mock.calls[0];
    expect(findManyArgs).toMatchObject({ where: { credentialsEncrypted: { not: null } } });
  });

  it("collects per-row errors instead of throwing, and keeps processing remaining rows", async () => {
    vi.mocked(db.shop.findMany).mockResolvedValue([
      { id: "shop-bad", accessTokenEncrypted: "not-valid-base64-ciphertext" },
      { id: "shop-good", accessTokenEncrypted: encrypt("fine") },
    ] as never);
    vi.mocked(db.erpConnection.findMany).mockResolvedValue([]);

    const result = await reencryptStaleCredentials();

    expect(result.shopsUpdated).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ table: "shop", id: "shop-bad" });
  });
});
