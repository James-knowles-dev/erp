// Acumatica-specific shapes, mirroring app/adapters/netsuite/types.ts's structure. The one
// structural difference: Acumatica has no fixed API domain the way NetSuite's accountId-based
// subdomain works -- each customer's instance lives at its own URL (self-hosted or
// {something}.acumatica.com), so that URL is itself a required credential field here, not a
// hardcoded pattern.

export interface AcumaticaConfig {
  instanceUrl: string; // e.g. "https://mycompany.acumatica.com" -- no trailing slash
  clientId: string;
  clientSecret: string;
}

export interface AcumaticaTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO timestamp
}

// SKU -> nothing to resolve, actually: unlike NetSuite, Acumatica's contract-based REST API
// references stock items directly by InventoryID (which is the SKU), not an internal numeric id.
// Kept as a type alias anyway for symmetry with the NetSuite adapter and in case that assumption
// turns out wrong once verified against a live instance (decision D4).
export type AcumaticaItemIdMap = Record<string, string>;
