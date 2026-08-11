// Brightpearl OAuth 2.0 Authorization Code Grant (2026-08-10 research). Unlike the other three
// adapters, the client_id/secret here are *our* app's own credentials -- issued once by
// registering as a Brightpearl developer/app, the same way SHOPIFY_API_KEY/SECRET belong to this
// app rather than to each merchant -- not something a merchant generates in their own instance.
// Not yet exercised against a live Brightpearl developer account -- see decision D4 in
// README.md's Build Plan.

import type { BrightpearlTokens } from "./types";

function clientId(): string {
  const value = process.env.BRIGHTPEARL_CLIENT_ID;
  if (!value) throw new Error("BRIGHTPEARL_CLIENT_ID is not set.");
  return value;
}

function clientSecret(): string {
  const value = process.env.BRIGHTPEARL_CLIENT_SECRET;
  if (!value) throw new Error("BRIGHTPEARL_CLIENT_SECRET is not set.");
  return value;
}

interface BrightpearlTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  api_domain: string;
}

function toTokens(data: BrightpearlTokenResponse): BrightpearlTokens {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    apiDomain: data.api_domain,
  };
}

export function buildAuthorizationUrl(accountCode: string, redirectUri: string, state: string): string {
  const url = new URL(`https://oauth.brightpearlapp.com/authorize/${accountCode}`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCodeForTokens(
  accountCode: string,
  code: string,
  redirectUri: string,
): Promise<BrightpearlTokens> {
  const response = await fetch(`https://oauth.brightpearlapp.com/token/${accountCode}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId(),
      client_secret: clientSecret(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Brightpearl token exchange failed: ${response.status} ${await response.text()}`);
  }

  return toTokens((await response.json()) as BrightpearlTokenResponse);
}

export async function refreshAccessToken(accountCode: string, refreshToken: string): Promise<BrightpearlTokens> {
  const response = await fetch(`https://oauth.brightpearlapp.com/token/${accountCode}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Brightpearl token refresh failed: ${response.status} ${await response.text()}`);
  }

  return toTokens((await response.json()) as BrightpearlTokenResponse);
}
