// Sage Intacct-specific shapes. The one adapter of the four that isn't OAuth2 (dev spec §4:
// "Sender ID/password + session-based API") -- Intacct's XML Web Services Gateway uses a two-tier
// credential model: a Sender ID/password issued once to us via Sage's Partner Program (shared
// across every merchant, like our own app's API key -- see auth.server.ts), plus a per-merchant
// Company ID/User ID/User Password that merchant authorizes for that Sender ID inside their own
// Intacct company. There's no redirect-based consent screen the way OAuth2 has one -- see the
// header comment on auth.server.ts for how this still fits the wizard's redirect/callback shape.

export interface SageIntacctConfig {
  companyId: string;
  userId: string;
  userPassword: string;
}

export interface SageIntacctSession {
  sessionId: string;
  // Intacct's getAPISession response can return a session-specific gateway endpoint distinct from
  // the general one -- subsequent calls should target this, not assume the general gateway URL.
  endpoint: string;
  expiresAt: string; // ISO timestamp; not a documented fixed session lifetime (see auth.server.ts TODO(D4))
}

// SKU -> Intacct item id. Sales order/invoice lines reference items by ITEMID -- kept as a map for
// symmetry with the other adapters even though Intacct's ITEMID is usually the SKU itself rather
// than a separate internal id (see transform.ts).
export type SageIntacctItemIdMap = Record<string, string>;
