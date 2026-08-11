// NetSuite OAuth 2.0 Authorization Code Grant. Endpoint URLs and flow verified against NetSuite's
// documented pattern (2026-08-10 research), not yet exercised against a live account -- see
// decision D4 in README.md's Build Plan. Uses OAuth 2.0 rather than Token-Based Auth (TBA)
// per decision D3: NetSuite blocks *new* TBA integrations from its 2027.1 release.

import type { NetSuiteConfig, NetSuiteTokens } from "./types";

const SCOPE = "rest_webservices";

function tokenEndpoint(accountId: string): string {
  return `https://${accountId}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

interface NetSuiteTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

function toTokens(data: NetSuiteTokenResponse, previousRefreshToken?: string): NetSuiteTokens {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previousRefreshToken ?? "",
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

// Step 1 of the wizard's "Connect" step (product spec §7.1 step 2): redirect the merchant here
// to log into their own NetSuite account and consent.
export function buildAuthorizationUrl(
  config: Pick<NetSuiteConfig, "accountId" | "clientId">,
  redirectUri: string,
  state: string,
): string {
  const url = new URL(`https://${config.accountId}.app.netsuite.com/app/login/oauth2/authorize.nl`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);
  return url.toString();
}

// Step 2: exchange the authorization code NetSuite redirected back with for real tokens.
export async function exchangeCodeForTokens(
  config: NetSuiteConfig,
  code: string,
  redirectUri: string,
): Promise<NetSuiteTokens> {
  const response = await fetch(tokenEndpoint(config.accountId), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(config.clientId, config.clientSecret),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`NetSuite token exchange failed: ${response.status} ${await response.text()}`);
  }

  return toTokens((await response.json()) as NetSuiteTokenResponse);
}

// Access tokens are short-lived (~60 min per NetSuite's docs) -- call this before every batch of
// API calls if expiresAt has passed, rather than waiting for a 401.
export async function refreshAccessToken(
  config: NetSuiteConfig,
  refreshToken: string,
): Promise<NetSuiteTokens> {
  const response = await fetch(tokenEndpoint(config.accountId), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(config.clientId, config.clientSecret),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`NetSuite token refresh failed: ${response.status} ${await response.text()}`);
  }

  return toTokens((await response.json()) as NetSuiteTokenResponse, refreshToken);
}
