// Sage 300 has no OAuth2 (or any redirect-based) flow -- just HTTP Basic Auth against a
// merchant-hosted Web API endpoint (2026-08-10 research). Same self-redirect approach as Sage
// Intacct's auth.server.ts: buildAuthorizationUrl points straight back at our own callback with a
// placeholder code, and exchangeCodeForTokens does the real work -- a lightweight authenticated
// request to confirm the submitted credentials actually work, rather than any real "exchange."
// Not yet exercised against a live Sage 300 install -- see decision D4 in
// erp-connector-build-plan.md.

import type { Sage300Config } from "./types";

export function buildAuthorizationUrl(_config: unknown, redirectUri: string, state: string): string {
  return `${redirectUri}?code=direct&state=${encodeURIComponent(state)}`;
}

export function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

// Basic Auth has no token/expiry concept -- the "access token" stored is just the pre-computed
// Authorization header value, and expiresAt is a nominal far-future date so the rest of the app's
// credential-shape assumptions (every adapter's stored values include an expiresAt) still hold.
const NOMINAL_NO_EXPIRY = "2099-01-01T00:00:00.000Z";

export async function exchangeCodeForTokens(
  config: Sage300Config,
  _code: string,
  _redirectUri: string,
): Promise<Record<string, string>> {
  const authHeader = basicAuthHeader(config.username, config.password);

  // ICItems is a small, always-present resource in any Sage 300 install -- a cheap way to confirm
  // the server URL, company, and credentials are all correct before storing them as "active".
  const testUrl = `${config.serverUrl.replace(/\/$/, "")}/v1.0/-/${config.company}/IC/ICItems?$top=1`;
  const response = await fetch(testUrl, { headers: { Authorization: authHeader, Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Sage 300 connection test failed: ${response.status} ${await response.text()}`);
  }

  return { accessToken: authHeader, refreshToken: "", expiresAt: NOMINAL_NO_EXPIRY };
}
