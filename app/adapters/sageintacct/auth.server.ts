// Sage Intacct XML Web Services Gateway session establishment (2026-08-10 research). No OAuth2
// redirect/consent screen exists for this flow -- the merchant just gives us their Company ID/
// User ID/User Password directly in the wizard form (step 2), and we establish a session
// server-side by combining that with our own Sender ID/password (issued once via Sage's Partner
// Program, analogous to this app's own SHOPIFY_API_KEY/SECRET -- never merchant-entered).
//
// The wizard's connect route (app.connect.$erpType.tsx) always redirects to
// buildAuthorizationUrl(...) and expects the ERP to eventually redirect back to our own callback
// with a `code` -- rather than reshaping that route around ERPs that don't have an external
// authorize page, buildAuthorizationUrl here just points straight back at our own callback with a
// placeholder code; all the real work happens in exchangeCodeForTokens using the values already
// stored from the form. See registry.server.ts's authType field, which callback.tsx now reads
// per-ERP instead of assuming oauth2.
//
// Not yet exercised against a live Sage Intacct account -- see decision D4 in
// erp-connector-build-plan.md.

import { XMLBuilder, XMLParser } from "fast-xml-parser";
import type { SageIntacctConfig, SageIntacctSession } from "./types";

const GATEWAY_URL = "https://api.intacct.com/ia/xml/xmlgw.gateway";

function senderId(): string {
  const value = process.env.SAGE_INTACCT_SENDER_ID;
  if (!value) throw new Error("SAGE_INTACCT_SENDER_ID is not set.");
  return value;
}

function senderPassword(): string {
  const value = process.env.SAGE_INTACCT_SENDER_PASSWORD;
  if (!value) throw new Error("SAGE_INTACCT_SENDER_PASSWORD is not set.");
  return value;
}

const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_" });
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

export function buildAuthorizationUrl(_config: unknown, redirectUri: string, state: string): string {
  return `${redirectUri}?code=direct&state=${encodeURIComponent(state)}`;
}

// TODO(D4): Intacct's documented session lifetime isn't consistently stated across sources found
// during research -- some report ~1 hour, configurable per company. Used as a conservative
// placeholder pending verification against a live account; refreshAccessToken below re-establishes
// a session from scratch rather than a true token refresh, since getAPISession has no refresh-token
// concept of its own.
const ASSUMED_SESSION_LIFETIME_MS = 55 * 60 * 1000;

interface GetApiSessionResult {
  sessionid?: string;
  endpoint?: string;
}

// TODO(D4): the exact nesting of a successful getAPISession response
// (response.operation.result.data.api.{sessionid,endpoint} below) is reconstructed from Intacct's
// general XML Gateway response conventions, not independently verified against a live call --
// confirm before relying on this in production. Errors are handled defensively: any deviation
// from the expected shape surfaces as a thrown Error rather than a silent undefined session.
export async function exchangeCodeForTokens(
  config: SageIntacctConfig,
  _code: string,
  _redirectUri: string,
): Promise<Record<string, string>> {
  const session = await establishSession(config);
  return {
    accessToken: session.sessionId,
    refreshToken: "",
    expiresAt: session.expiresAt,
    endpoint: session.endpoint,
  };
}

export async function establishSession(config: SageIntacctConfig): Promise<SageIntacctSession> {
  const controlId = `session-${Date.now()}`;
  const requestBody = builder.build({
    "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
    request: {
      control: {
        senderid: senderId(),
        password: senderPassword(),
        controlid: controlId,
        uniqueid: "false",
        dtdversion: "3.0",
        includewhitespace: "false",
      },
      operation: {
        authentication: {
          login: {
            userid: config.userId,
            companyid: config.companyId,
            password: config.userPassword,
          },
        },
        content: {
          function: { "@_controlid": "getSession", getAPISession: {} },
        },
      },
    },
  });

  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: requestBody,
  });

  if (!response.ok) {
    throw new Error(`Sage Intacct session request failed: ${response.status} ${await response.text()}`);
  }

  const parsed = parser.parse(await response.text());
  const result = parsed?.response?.operation?.result;
  const status = result?.status ?? parsed?.response?.control?.status;
  if (status !== "success") {
    const message = result?.errormessage?.error?.description2 ?? result?.errormessage ?? "Unknown error";
    throw new Error(`Sage Intacct session request was not successful: ${JSON.stringify(message)}`);
  }

  const api: GetApiSessionResult = result?.data?.api ?? {};
  if (!api.sessionid || !api.endpoint) {
    throw new Error("Sage Intacct getAPISession response did not include a sessionid/endpoint.");
  }

  return {
    sessionId: api.sessionid,
    endpoint: api.endpoint,
    expiresAt: new Date(Date.now() + ASSUMED_SESSION_LIFETIME_MS).toISOString(),
  };
}
