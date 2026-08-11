import crypto from "node:crypto";

// Shared secret auth for internal.status.tsx -- factored out of that route file (rather than kept
// inline) so it can be unit tested without pulling in that route's other imports (bullmq,
// scheduler.server.ts -> shopify.server.ts), which need full app/Redis config just to load.

export function checkInternalDashboardAuth(request: Request): void {
  const token = process.env.INTERNAL_DASHBOARD_TOKEN;
  if (!token) throw new Response("INTERNAL_DASHBOARD_TOKEN is not set.", { status: 503 });
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header);
  // Fixed-size comparison buffer, not `actual`/`expected` directly -- timingSafeEqual throws on
  // a length mismatch, and comparing against a length derived from attacker input would itself
  // leak the token's length via which branch throws (erp-connector-fixes-spec.md F16).
  const actualPadded = Buffer.alloc(expected.length);
  actual.copy(actualPadded);
  const authorized = actual.length === expected.length && crypto.timingSafeEqual(actualPadded, expected);
  if (!authorized) throw new Response("Unauthorized", { status: 401 });
}
