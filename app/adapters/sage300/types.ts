// Sage 300-specific shapes. The other non-OAuth2 adapter (dev spec §4: "API key-based"; more
// precisely HTTP Basic Auth per 2026-08-10 research, not a distinct API-key header). The bigger
// architectural difference: Sage 300 is predominantly self-hosted per customer (their own
// IIS-hosted Web API, not a vendor-hosted multi-tenant service the way NetSuite/Acumatica/
// Business Central/Brightpearl all are) -- serverUrl is *their* endpoint, which they (or their
// VAR) must have already exposed for us to reach, not a domain we control or can assume.

export interface Sage300Config {
  serverUrl: string; // e.g. "https://erp.mycompany.com/Sage300WebApi" -- no trailing slash
  company: string; // Org/company database ID, e.g. "SAMLTD"
  username: string;
  password: string;
}

// SKU -> Sage 300 item number. Kept as a map for symmetry with the other adapters even though
// Sage 300's ItemNumber is usually the SKU itself -- see transform.ts.
export type Sage300ItemIdMap = Record<string, string>;
