// NetSuite-specific shapes, kept separate from the generic ERPCredentials/ERPDocumentRef in
// app/adapters/types.ts so the adapter's internals aren't forced through the lossy generic shape
// internally, only at the ERPAdapter interface boundary.

export interface NetSuiteConfig {
  accountId: string; // e.g. "1234567" (production) or "1234567_SB1" (sandbox)
  clientId: string;
  clientSecret: string;
}

export interface NetSuiteTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO timestamp; access tokens are short-lived (~60 min) per NetSuite OAuth 2.0
}

// SKU -> NetSuite internal item id. NetSuite's REST Record API references line items by
// internal id, not SKU, so this lookup has to happen before a sales order can be built --
// see resolveItemIds() in client.server.ts.
export type NetSuiteItemIdMap = Record<string, string>;
