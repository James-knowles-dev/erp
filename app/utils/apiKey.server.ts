import crypto from "node:crypto";
import db from "../db.server";

// Authenticates agency-facing API routes (app/routes/api.*) -- distinct from Shopify's session
// auth, since an agency's own script or middleware (product spec §7.7) isn't a merchant sitting
// in the embedded admin. One key per ErpConnection, hashed at rest (see the schema comment on
// ErpConnection.apiKeyHash for why hash rather than encrypt).

const KEY_PREFIX = "erpc_"; // lets a leaked key be recognized at a glance, same idea as Stripe's sk_/pk_ prefixes

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): string {
  return `${KEY_PREFIX}${crypto.randomBytes(24).toString("hex")}`;
}

export async function setApiKey(connectionId: string, key: string): Promise<void> {
  await db.erpConnection.update({
    where: { id: connectionId },
    data: { apiKeyHash: hashKey(key) },
  });
}

// Returns the authenticated connection, or throws a 401 Response -- callers can let this
// propagate directly out of a loader/action.
export async function requireApiKeyConnection(request: Request) {
  const header = request.headers.get("authorization");
  const key = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!key) throw new Response("Missing Authorization: Bearer <api key> header.", { status: 401 });

  const connection = await db.erpConnection.findUnique({ where: { apiKeyHash: hashKey(key) } });
  if (!connection) throw new Response("Invalid API key.", { status: 401 });

  return connection;
}
