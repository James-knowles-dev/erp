import db from "../db.server";
import { decrypt, encrypt, currentKeyVersion } from "./encryption.server";

// Completes a key rotation (erp-connector-fixes-spec.md F12): encryption.server.ts's version byte
// lets old ciphertext keep decrypting under its own key indefinitely, but nothing moves it forward
// on its own -- data encrypted before a rotation stays on the old key version forever unless
// something re-encrypts it. This is that something: a maintenance operation, not merchant-facing,
// run manually after bumping ENCRYPTION_KEY_VERSION and deploying the new version's key env var
// (same "operational tool outside the UI" pattern as internal.status.tsx).
//
// Safe to run repeatedly / at any time, including with nothing to rotate -- rows already on the
// current version are read, decrypted, and re-encrypted right back to an equivalent (new iv, same
// plaintext) ciphertext under the same version, which is a no-op in effect.

export interface ReencryptionResult {
  shopsUpdated: number;
  connectionsUpdated: number;
  errors: Array<{ table: "shop" | "erp_connection"; id: string; message: string }>;
}

export async function reencryptStaleCredentials(): Promise<ReencryptionResult> {
  const version = currentKeyVersion();
  const result: ReencryptionResult = { shopsUpdated: 0, connectionsUpdated: 0, errors: [] };

  const shops = await db.shop.findMany({ select: { id: true, accessTokenEncrypted: true } });
  for (const shop of shops) {
    try {
      const reencrypted = encrypt(decrypt(shop.accessTokenEncrypted));
      await db.shop.update({ where: { id: shop.id }, data: { accessTokenEncrypted: reencrypted } });
      result.shopsUpdated += 1;
    } catch (err) {
      result.errors.push({ table: "shop", id: shop.id, message: err instanceof Error ? err.message : String(err) });
    }
  }

  const connections = await db.erpConnection.findMany({
    where: { credentialsEncrypted: { not: null } },
    select: { id: true, credentialsEncrypted: true },
  });
  for (const connection of connections) {
    try {
      // credentialsEncrypted is nullable in the schema (a connection can exist before OAuth
      // completes) but this query already filters those out.
      const reencrypted = encrypt(decrypt(connection.credentialsEncrypted!));
      await db.erpConnection.update({ where: { id: connection.id }, data: { credentialsEncrypted: reencrypted } });
      result.connectionsUpdated += 1;
    } catch (err) {
      result.errors.push({ table: "erp_connection", id: connection.id, message: err instanceof Error ? err.message : String(err) });
    }
  }

  console.log(
    `reencryptStaleCredentials: moved ${result.shopsUpdated} shop(s) and ${result.connectionsUpdated} ` +
      `connection(s) to key version ${version}${result.errors.length > 0 ? ` (${result.errors.length} error(s), see above)` : ""}.`,
  );
  return result;
}
