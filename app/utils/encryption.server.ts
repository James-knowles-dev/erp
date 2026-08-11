import crypto from "node:crypto";

// v1 encryption approach per README.md's Build Plan decision D2: envelope encryption with
// a master key held in a Railway service variable, rather than a dedicated cloud KMS -- named
// tech debt, revisit before this handles high-value ERP credentials at scale (see D2's KMS
// alternative).
//
// Key rotation (erp-connector-fixes-spec.md F12, hardening pass 2026-08-11): ciphertext is now
// `version byte + iv + authTag + ciphertext`. `encrypt()` always uses the version named by
// ENCRYPTION_KEY_VERSION (default 1); `decrypt()` reads the version byte back out and looks up
// that version's key, so data encrypted under an old key keeps decrypting after
// ENCRYPTION_KEY_VERSION is bumped to point new encryptions at a new key -- see
// reencryptCredentials.server.ts for actually completing a rotation (re-encrypting existing rows
// under the new current version). No fallback for the pre-versioning format (bare iv+authTag+
// ciphertext, no leading byte): per the README, nothing has been exercised against a real ERP
// account yet, so there's no production ciphertext this needs to stay compatible with.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // standard GCM nonce length
const AUTH_TAG_LENGTH = 16;
const VERSION_LENGTH = 1;

function envVarForVersion(version: number): string {
  // Version 1 keeps the original variable name -- no rename needed to adopt this scheme.
  return version === 1 ? "ENCRYPTION_MASTER_KEY" : `ENCRYPTION_MASTER_KEY_V${version}`;
}

function getKeyForVersion(version: number): Buffer {
  const envVar = envVarForVersion(version);
  const keyBase64 = process.env[envVar];
  if (!keyBase64) {
    throw new Error(
      `${envVar} is not set (needed to decrypt/encrypt data at key version ${version}). ` +
        "Generate one with `openssl rand -base64 32` -- see README.md's Build Plan decision D2 " +
        "and erp-connector-fixes-spec.md F12.",
    );
  }
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error(`${envVar} must decode to exactly 32 bytes (AES-256).`);
  }
  return key;
}

// The version encrypt() writes new ciphertext under. Bump ENCRYPTION_KEY_VERSION once the new
// version's key env var is in place to start a rotation; old ciphertext keeps decrypting under
// its own embedded version until reencryptCredentials.server.ts moves it forward.
export function currentKeyVersion(): number {
  const raw = process.env.ENCRYPTION_KEY_VERSION;
  if (!raw) return 1;
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`ENCRYPTION_KEY_VERSION must be a positive integer, got "${raw}".`);
  }
  return version;
}

// Encrypts a plaintext string. Returns a single base64 string packing
// version + iv + authTag + ciphertext, so callers only need to persist one column value (matches
// *_encrypted columns in the dev spec).
export function encrypt(plaintext: string): string {
  const version = currentKeyVersion();
  const key = getKeyForVersion(version);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([version]), iv, authTag, ciphertext]).toString("base64");
}

export function decrypt(encoded: string): string {
  const raw = Buffer.from(encoded, "base64");
  const version = raw.readUInt8(0);
  const key = getKeyForVersion(version);
  const iv = raw.subarray(VERSION_LENGTH, VERSION_LENGTH + IV_LENGTH);
  const authTag = raw.subarray(VERSION_LENGTH + IV_LENGTH, VERSION_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(VERSION_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
