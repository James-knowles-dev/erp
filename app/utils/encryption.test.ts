import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { currentKeyVersion, decrypt, encrypt } from "./encryption.server";

// encryption.server.ts reads its env vars fresh on every encrypt()/decrypt() call (no module-load-
// time caching), so mutating process.env directly per test -- no re-import needed -- exercises the
// real read path.

const KEY_V1 = crypto.randomBytes(32).toString("base64");
const KEY_V2 = crypto.randomBytes(32).toString("base64");

describe("encryption.server", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = KEY_V1;
    delete process.env.ENCRYPTION_MASTER_KEY_V2;
    delete process.env.ENCRYPTION_KEY_VERSION;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("round-trips a plaintext under the default version (1)", () => {
    const ciphertext = encrypt("super-secret-token");
    expect(decrypt(ciphertext)).toBe("super-secret-token");
  });

  it("defaults currentKeyVersion() to 1 when ENCRYPTION_KEY_VERSION is unset", () => {
    expect(currentKeyVersion()).toBe(1);
  });

  it("encrypts under the version named by ENCRYPTION_KEY_VERSION once rotated", () => {
    process.env.ENCRYPTION_MASTER_KEY_V2 = KEY_V2;
    process.env.ENCRYPTION_KEY_VERSION = "2";

    const ciphertext = encrypt("post-rotation-secret");
    expect(decrypt(ciphertext)).toBe("post-rotation-secret");

    const raw = Buffer.from(ciphertext, "base64");
    expect(raw.readUInt8(0)).toBe(2);
  });

  it("still decrypts a v1 ciphertext after rotating ENCRYPTION_KEY_VERSION to 2", () => {
    const v1Ciphertext = encrypt("pre-rotation-secret"); // ENCRYPTION_KEY_VERSION unset -> v1

    process.env.ENCRYPTION_MASTER_KEY_V2 = KEY_V2;
    process.env.ENCRYPTION_KEY_VERSION = "2";

    expect(decrypt(v1Ciphertext)).toBe("pre-rotation-secret");
  });

  it("throws a clear error when the key for a referenced version is missing", () => {
    process.env.ENCRYPTION_KEY_VERSION = "2"; // no ENCRYPTION_MASTER_KEY_V2 set
    expect(() => encrypt("x")).toThrow(/ENCRYPTION_MASTER_KEY_V2 is not set/);
  });

  it("throws if ENCRYPTION_KEY_VERSION isn't a positive integer", () => {
    process.env.ENCRYPTION_KEY_VERSION = "not-a-number";
    expect(() => encrypt("x")).toThrow(/must be a positive integer/);
  });

  it("fails to decrypt a tampered ciphertext (GCM auth tag mismatch)", () => {
    const ciphertext = encrypt("integrity-checked");
    const raw = Buffer.from(ciphertext, "base64");
    raw[raw.length - 1] ^= 0xff; // flip the last ciphertext byte
    expect(() => decrypt(raw.toString("base64"))).toThrow();
  });
});
