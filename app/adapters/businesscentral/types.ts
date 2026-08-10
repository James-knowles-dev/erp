// Business Central-specific shapes, mirroring the NetSuite/Acumatica adapters' types.ts files.
// Structurally the most demanding credential shape of the three built so far: NetSuite needs one
// identifier (accountId), Acumatica needs one (instanceUrl), Business Central needs three --
// Azure AD tenantId, the BC environment name, and the companyId within that environment, since
// its data model is scoped tenant -> environment -> company.

export interface BusinessCentralConfig {
  tenantId: string; // Azure AD tenant id (GUID or domain, e.g. "contoso.onmicrosoft.com")
  environment: string; // e.g. "Production" or "Sandbox"
  companyId: string; // GUID of the company within that environment
  clientId: string;
  clientSecret: string;
}

export interface BusinessCentralTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO timestamp; access tokens last up to 1 hour per Microsoft's docs
}

// SKU -> Business Central item GUID. Line items reference items by internal id (itemId) even
// though the request body also carries the item number (lineObjectNumber) alongside it -- see
// transform.ts.
export type BusinessCentralItemIdMap = Record<string, string>;
