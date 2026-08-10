import crypto from "node:crypto";
import { createCookieSessionStorage, redirect } from "@remix-run/node";
import db from "../db.server";

// Agencies aren't Shopify shops, so this whole layer needs its own auth -- every other route in
// this app authenticates via Shopify's embedded session (app/shopify.server.ts); agency routes
// (app/routes/agency.*) go through this instead. Password hashing uses Node's built-in scrypt
// rather than adding bcrypt/argon2 as a new dependency -- scrypt is a real KDF (not a plain hash),
// which is what actually matters here, and it ships in Node already.

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  // timingSafeEqual requires equal-length buffers -- a length mismatch means "wrong password,"
  // not a crash, but comparing it directly would throw.
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

const sessionSecret = process.env.AGENCY_SESSION_SECRET;
if (!sessionSecret && process.env.NODE_ENV === "production") {
  // Fail loudly at boot, not silently at the first login attempt.
  throw new Error("AGENCY_SESSION_SECRET is not set.");
}

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__agency_session",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    secrets: [sessionSecret ?? "dev-only-insecure-secret"],
    path: "/agency",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  },
});

export async function createAgencyAccount(agencyName: string, email: string, password: string) {
  const existing = await db.agencyUser.findUnique({ where: { email } });
  if (existing) throw new Error("An account with this email already exists.");

  const agency = await db.agency.create({ data: { name: agencyName } });
  const user = await db.agencyUser.create({
    data: { agencyId: agency.id, email, passwordHash: hashPassword(password), role: "owner" },
  });
  return user;
}

export async function verifyAgencyLogin(email: string, password: string) {
  const user = await db.agencyUser.findUnique({ where: { email } });
  if (!user || !verifyPassword(password, user.passwordHash)) return null;
  return user;
}

export async function createAgencySession(userId: string, redirectTo: string) {
  const session = await sessionStorage.getSession();
  session.set("agencyUserId", userId);
  return redirect(redirectTo, {
    headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
  });
}

export async function destroyAgencySession(request: Request) {
  const session = await sessionStorage.getSession(request.headers.get("Cookie"));
  return redirect("/agency/login", {
    headers: { "Set-Cookie": await sessionStorage.destroySession(session) },
  });
}

export async function requireAgencyUser(request: Request) {
  const session = await sessionStorage.getSession(request.headers.get("Cookie"));
  const userId = session.get("agencyUserId");
  if (!userId) throw redirect("/agency/login");

  const user = await db.agencyUser.findUnique({ where: { id: userId }, include: { agency: true } });
  if (!user) throw redirect("/agency/login");
  return user;
}

// 'owner'/'admin' see every client linked to the agency; 'staff' needs an explicit
// AgencyUserClientAccess row for this specific client. Throws a 403 Response rather than
// returning null/undefined -- every call site wants this to be fatal, not a value to check.
export async function requireAgencyClientAccess(
  agencyUser: { id: string; agencyId: string; role: string },
  shopId: string,
) {
  const link = await db.agencyClientLink.findFirst({
    where: { agencyId: agencyUser.agencyId, shopId },
  });
  if (!link) throw new Response("Client not linked to this agency.", { status: 404 });

  if (agencyUser.role === "owner" || agencyUser.role === "admin") return link;

  const access = await db.agencyUserClientAccess.findUnique({
    where: {
      agencyUserId_agencyClientLinkId: { agencyUserId: agencyUser.id, agencyClientLinkId: link.id },
    },
  });
  if (!access) throw new Response("You don't have access to this client.", { status: 403 });
  return link;
}
