// Acumatica OAuth 2.0 Authorization Code Grant. Endpoint pattern verified against Acumatica's
// documented flow (2026-08-10 research), not yet exercised against a live instance -- see
// decision D4 in README.md's Build Plan. Structurally similar to the NetSuite adapter's
// auth.server.ts, but endpoints are relative to the customer's own instance URL rather than a
// vendor-hosted domain pattern -- see AcumaticaConfig's comment in types.ts.

import type { AcumaticaConfig, AcumaticaTokens } from "./types";

const SCOPE = "api offline_access"; // offline_access is required to get a refresh token back

function authorizeEndpoint(instanceUrl: string): string {
  return `${instanceUrl}/identity/connect/authorize`;
}

function tokenEndpoint(instanceUrl: string): string {
  return `${instanceUrl}/identity/connect/token`;
}

interface AcumaticaTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

function toTokens(data: AcumaticaTokenResponse, previousRefreshToken?: string): AcumaticaTokens {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previousRefreshToken ?? "",
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

export function buildAuthorizationUrl(
  config: Pick<AcumaticaConfig, "instanceUrl" | "clientId">,
  redirectUri: string,
  state: string,
): string {
  const url = new URL(authorizeEndpoint(config.instanceUrl));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCodeForTokens(
  config: AcumaticaConfig,
  code: string,
  redirectUri: string,
): Promise<AcumaticaTokens> {
  const response = await fetch(tokenEndpoint(config.instanceUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!response.ok) {
    throw new Error(`Acumatica token exchange failed: ${response.status} ${await response.text()}`);
  }

  return toTokens((await response.json()) as AcumaticaTokenResponse);
}

export async function refreshAccessToken(
  config: AcumaticaConfig,
  refreshToken: string,
): Promise<AcumaticaTokens> {
  const response = await fetch(tokenEndpoint(config.instanceUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!response.ok) {
    throw new Error(`Acumatica token refresh failed: ${response.status} ${await response.text()}`);
  }

  return toTokens((await response.json()) as AcumaticaTokenResponse, refreshToken);
}
