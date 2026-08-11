// Business Central OAuth 2.0 via Azure AD (Microsoft Entra ID) Authorization Code Grant.
// Endpoint pattern verified against Microsoft's documented flow (2026-08-10 research), not yet
// exercised against a live environment -- see decision D4 in README.md's Build Plan.
// Structurally similar to the NetSuite/Acumatica adapters' auth.server.ts files, but endpoints
// are Microsoft's shared Azure AD domain parameterized by tenantId, not the customer's own
// instance domain the way Acumatica's are.

import type { BusinessCentralConfig, BusinessCentralTokens } from "./types";

const SCOPE = "https://api.businesscentral.dynamics.com/.default offline_access";

function authorizeEndpoint(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`;
}

function tokenEndpoint(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
}

interface BusinessCentralTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

function toTokens(
  data: BusinessCentralTokenResponse,
  previousRefreshToken?: string,
): BusinessCentralTokens {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previousRefreshToken ?? "",
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

export function buildAuthorizationUrl(
  config: Pick<BusinessCentralConfig, "tenantId" | "clientId">,
  redirectUri: string,
  state: string,
): string {
  const url = new URL(authorizeEndpoint(config.tenantId));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCodeForTokens(
  config: BusinessCentralConfig,
  code: string,
  redirectUri: string,
): Promise<BusinessCentralTokens> {
  const response = await fetch(tokenEndpoint(config.tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: SCOPE,
    }),
  });

  if (!response.ok) {
    throw new Error(`Business Central token exchange failed: ${response.status} ${await response.text()}`);
  }

  return toTokens((await response.json()) as BusinessCentralTokenResponse);
}

export async function refreshAccessToken(
  config: BusinessCentralConfig,
  refreshToken: string,
): Promise<BusinessCentralTokens> {
  const response = await fetch(tokenEndpoint(config.tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: SCOPE,
    }),
  });

  if (!response.ok) {
    throw new Error(`Business Central token refresh failed: ${response.status} ${await response.text()}`);
  }

  return toTokens((await response.json()) as BusinessCentralTokenResponse, refreshToken);
}
