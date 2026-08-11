// Brightpearl-specific shapes. Structurally the most standard OAuth2 adapter of the four built so
// far (see auth.server.ts), but with one real difference: the OAuth client_id/secret belong to
// *our* app (registered once in Brightpearl's Developer Area, like a Shopify app's own API key),
// not to each merchant's own instance the way NetSuite/Acumatica/Business Central's Integration
// records do. A merchant only ever gives us their Brightpearl account code -- everything else
// (client credentials, the regional datacenter host) is either ours or resolved automatically.

export interface BrightpearlConfig {
  accountCode: string; // e.g. "mystore" -- the merchant's Brightpearl account identifier
}

export interface BrightpearlTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO timestamp; Brightpearl access tokens are reported to last ~7 days
  // Brightpearl accounts are spread across regional datacenters (e.g. ws-usa1.brightpearl.com) --
  // the OAuth token response tells us which one this account lives on. Cached here rather than
  // guessed/hardcoded, since assuming a single datacenter would silently break for accounts on
  // any other region.
  apiDomain: string;
}

// SKU -> Brightpearl product id. Sales order/credit rows reference products by internal id, not
// SKU directly -- see transform.ts.
export type BrightpearlProductIdMap = Record<string, string>;
