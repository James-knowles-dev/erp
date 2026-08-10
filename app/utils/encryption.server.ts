import crypto from "node:crypto";

// v1 encryption approach per erp-connector-build-plan.md decision D2: envelope encryption with
// a single master key held in a Railway service variable, rather than a dedicated cloud KMS.
// Faster to ship, but doesn't give per-key rotation or audit logging -- named tech debt, revisit
// before this handles high-value ERP credentials at scale (see D2's KMS alternative).

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // standard GCM nonce length
const AUTH_TAG_LENGTH = 16;

function getMasterKey(): Buffer {
  const keyBase64 = process.env.ENCRYPTION_MASTER_KEY;
  if (!keyBase64) {
    throw new Error(
      "ENCRYPTION_MASTER_KEY is not set. Generate one with `openssl rand -base64 32` " +
        "and set it as a Railway service variable -- see erp-connector-build-plan.md decision D2.",
    );
  }
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_MASTER_KEY must decode to exactly 32 bytes (AES-256).");
  }
  return key;
}

// Encrypts a plaintext string. Returns a single base64 string packing iv + authTag + ciphertext,
// so callers only need to persist one column value (matches *_encrypted columns in the dev spec).
export function encrypt(plaintext: string): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decrypt(encoded: string): string {
  const key = getMasterKey();
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
