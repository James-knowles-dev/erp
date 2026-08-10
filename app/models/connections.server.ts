import db from "../db.server";
import { decrypt, encrypt } from "../utils/encryption.server";
import type { NetSuiteConfig, NetSuiteTokens } from "../adapters/netsuite/types";

// Wraps the erp_connections table (erp-connector-dev-spec.md §5) with the encrypt/decrypt step
// so no route handler ever has to remember to do it itself.

export async function getOrCreateShop(shopifyDomain: string) {
  const existing = await db.shop.findUnique({ where: { shopifyDomain } });
  if (existing) return existing;
  // Shopify's OAuth (app/shopify.server.ts) is what actually authorizes the install; this just
  // backfills our own app-level Shop row the first time a shop reaches the wizard, in case the
  // access-token-storage hook that should create it on install hasn't been wired up yet.
  return db.shop.create({
    data: {
      shopifyDomain,
      accessTokenEncrypted: encrypt(""),
      installedAt: new Date(),
      planTier: "unassigned",
    },
  });
}

export async function createConnection(shopId: string, erpType: string) {
  return db.erpConnection.create({
    data: { shopId, erpType, environment: "sandbox", status: "pending" },
  });
}

export async function getConnection(id: string) {
  return db.erpConnection.findUnique({ where: { id } });
}

export async function getActiveConnectionForShop(shopId: string) {
  // v1 assumes one active connection per shop (dev spec §5) -- most recent non-disabled wins.
  return db.erpConnection.findFirst({
    where: { shopId, status: { not: "disabled" } },
    orderBy: { connectedAt: "desc" },
  });
}

export async function setEnvironment(connectionId: string, environment: "sandbox" | "production") {
  return db.erpConnection.update({ where: { id: connectionId }, data: { environment } });
}

interface NetSuiteCredentialBundle extends NetSuiteConfig, NetSuiteTokens {}

// Persists just accountId/clientId/clientSecret before the OAuth redirect to NetSuite, so the
// callback route (a separate request, after the merchant leaves and comes back) can load them
// back out to complete the token exchange. Status stays 'pending' -- this isn't a real
// connection yet, just enough state to survive the redirect round-trip. clientSecret is the only
// genuinely sensitive value here, hence encrypting the whole bundle rather than passing it
// through the OAuth `state` param (which NetSuite echoes back in a plain query string).
export async function storePartialNetSuiteConfig(connectionId: string, config: NetSuiteConfig) {
  return db.erpConnection.update({
    where: { id: connectionId },
    data: { credentialsEncrypted: encrypt(JSON.stringify(config)) },
  });
}

export async function storeNetSuiteCredentials(
  connectionId: string,
  credentials: NetSuiteCredentialBundle,
) {
  return db.erpConnection.update({
    where: { id: connectionId },
    data: {
      credentialsEncrypted: encrypt(JSON.stringify(credentials)),
      status: "active",
      connectedAt: new Date(),
    },
  });
}

export async function loadNetSuiteCredentials(
  connectionId: string,
): Promise<NetSuiteCredentialBundle | null> {
  const connection = await db.erpConnection.findUnique({ where: { id: connectionId } });
  if (!connection?.credentialsEncrypted) return null;
  return JSON.parse(decrypt(connection.credentialsEncrypted)) as NetSuiteCredentialBundle;
}

export async function setConnectionStatus(connectionId: string, status: string) {
  return db.erpConnection.update({ where: { id: connectionId }, data: { status } });
}

export async function saveFieldMappings(
  connectionId: string,
  mappings: { shopifyField: string; erpField: string; transformRule?: string; isRequired: boolean }[],
) {
  await db.fieldMapping.deleteMany({ where: { connectionId } });
  await db.fieldMapping.createMany({
    data: mappings.map((m) => ({ connectionId, ...m })),
  });
}

export async function getFieldMappings(connectionId: string) {
  return db.fieldMapping.findMany({ where: { connectionId } });
}
