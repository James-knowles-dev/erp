// Shared HTTP retry wrapper for ERP adapter clients (erp-connector-fixes-spec.md F8). Every
// client.server.ts previously did a single fetch, checked response.ok, and threw -- no adapter
// respected 429/Retry-After or retried a transient network error, and none refreshed an expired
// token on 401, despite every adapter declaring a getRateLimitPolicy() backoffStrategy that was
// never actually consulted anywhere.
//
// Scope: 429 and network-error retry apply to every adapter that uses this (all 6). 401-refresh
// only applies where onUnauthorized is provided -- the four adapters with a plain bearer token and
// a refreshAccessToken() (NetSuite, Acumatica, Business Central, Brightpearl). Sage 300 (Basic
// Auth, no token to refresh -- a 401 means bad credentials, not expiry) and Sage Intacct (session
// auth, but errors come back as a 200 with a non-success XML result body, not an HTTP 401 --
// see sageintacct/client.server.ts's callFunction) don't pass onUnauthorized; they still get the
// 429/network retry behavior from this same helper.
//
// Refreshed tokens from onUnauthorized are used for the rest of this request/job only -- they
// aren't persisted back to storage here. The next sync job re-authenticates from the credentials
// still on record (see worker.server.ts's loadErpCredentials), so a token that's expired between
// jobs costs one extra refresh call rather than failing; wiring the refreshed token back into
// storage would need ERPAdapter.authenticate()'s caller to know a refresh happened, which is a
// larger interface change than this fix pass takes on.

export interface FetchWithErpRetryOptions {
  onUnauthorized?: () => Promise<string | null>;
  maxAttempts?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const dateMs = Date.parse(header);
  return Number.isNaN(dateMs) ? null : Math.max(0, dateMs - Date.now());
}

export async function fetchWithErpRetry(
  url: string,
  init: RequestInit,
  options: FetchWithErpRetryOptions = {},
): Promise<Response> {
  const maxAttempts = options.maxAttempts ?? 3;
  let currentInit = init;
  let reauthAttempted = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, currentInit);
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      await sleep(2 ** attempt * 500);
      continue;
    }

    if (response.status === 401 && options.onUnauthorized && !reauthAttempted) {
      reauthAttempted = true;
      const authHeader = await options.onUnauthorized();
      if (authHeader) {
        currentInit = { ...currentInit, headers: { ...currentInit.headers, Authorization: authHeader } };
        continue;
      }
    }

    if (response.status === 429 && attempt < maxAttempts) {
      const waitMs = parseRetryAfterMs(response.headers.get("Retry-After")) ?? 2 ** attempt * 500;
      await sleep(waitMs);
      continue;
    }

    return response;
  }

  // Unreachable in practice -- every branch above either returns or throws before the loop would
  // exit on its own, but the loop bound means TypeScript can't prove that.
  throw new Error("fetchWithErpRetry: exhausted retries without a response.");
}
