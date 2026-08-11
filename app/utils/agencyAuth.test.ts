import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "../db.server";
import {
  createAgencyAccount,
  createAgencySession,
  requireAgencyClientAccess,
  requireAgencyUser,
  verifyAgencyLogin,
} from "./agencyAuth.server";

vi.mock("../db.server", () => ({
  default: {
    agencyUser: { findUnique: vi.fn(), create: vi.fn() },
    agency: { create: vi.fn() },
    agencyClientLink: { findFirst: vi.fn() },
    agencyUserClientAccess: { findUnique: vi.fn() },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// Extracts the Set-Cookie header from a createAgencySession() redirect so other tests can act as
// that logged-in user, without reaching into agencyAuth.server's private sessionStorage.
async function loginCookie(userId: string): Promise<string> {
  const response = await createAgencySession(userId, "/agency/dashboard");
  const cookie = response.headers.get("Set-Cookie");
  if (!cookie) throw new Error("createAgencySession did not set a cookie");
  return cookie.split(";")[0]; // strip attributes (Path, HttpOnly, ...), keep name=value
}

describe("createAgencyAccount / verifyAgencyLogin", () => {
  it("rejects signup when the email is already registered", async () => {
    vi.mocked(db.agencyUser.findUnique).mockResolvedValue({ id: "existing" } as never);
    await expect(createAgencyAccount("Acme", "taken@example.com", "hunter2")).rejects.toThrow(
      "An account with this email already exists.",
    );
    expect(db.agency.create).not.toHaveBeenCalled();
  });

  it("hashes the password so the stored value never contains the plaintext", async () => {
    vi.mocked(db.agencyUser.findUnique).mockResolvedValue(null);
    vi.mocked(db.agency.create).mockResolvedValue({ id: "agency-1" } as never);
    vi.mocked(db.agencyUser.create).mockImplementation(
      (async (args: { data: { email: string; passwordHash: string } }) => ({ id: "user-1", ...args.data })) as never,
    );

    await createAgencyAccount("Acme", "new@example.com", "hunter2");

    const created = vi.mocked(db.agencyUser.create).mock.calls[0][0].data as { passwordHash: string };
    expect(created.passwordHash).not.toContain("hunter2");
    expect(created.passwordHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/); // salt:hash
  });

  it("verifyAgencyLogin returns null for an unknown email", async () => {
    vi.mocked(db.agencyUser.findUnique).mockResolvedValue(null);
    expect(await verifyAgencyLogin("nobody@example.com", "whatever")).toBeNull();
  });

  it("verifyAgencyLogin returns null for a wrong password, and the user for the right one", async () => {
    vi.mocked(db.agencyUser.findUnique).mockResolvedValue(null);
    vi.mocked(db.agency.create).mockResolvedValue({ id: "agency-1" } as never);
    let storedHash = "";
    vi.mocked(db.agencyUser.create).mockImplementation(
      (async (args: { data: { email: string; passwordHash: string } }) => {
        storedHash = args.data.passwordHash;
        return { id: "user-1", email: args.data.email, passwordHash: storedHash };
      }) as never,
    );
    await createAgencyAccount("Acme", "real@example.com", "correct-horse");

    vi.mocked(db.agencyUser.findUnique).mockResolvedValue({
      id: "user-1",
      email: "real@example.com",
      passwordHash: storedHash,
    } as never);

    expect(await verifyAgencyLogin("real@example.com", "wrong-password")).toBeNull();
    expect(await verifyAgencyLogin("real@example.com", "correct-horse")).toMatchObject({ id: "user-1" });
  });
});

describe("requireAgencyUser", () => {
  it("redirects to /agency/login when there's no session cookie", async () => {
    const request = new Request("https://example.com/agency/dashboard");
    await expect(requireAgencyUser(request)).rejects.toMatchObject({ status: 302 });
  });

  it("redirects to /agency/login when the session references a deleted user", async () => {
    const cookie = await loginCookie("ghost-user");
    vi.mocked(db.agencyUser.findUnique).mockResolvedValue(null);

    const request = new Request("https://example.com/agency/dashboard", { headers: { Cookie: cookie } });
    await expect(requireAgencyUser(request)).rejects.toMatchObject({ status: 302 });
  });

  it("returns the user for a valid session", async () => {
    const cookie = await loginCookie("user-1");
    const user = { id: "user-1", agencyId: "agency-1", role: "owner", agency: { id: "agency-1" } };
    vi.mocked(db.agencyUser.findUnique).mockResolvedValue(user as never);

    const request = new Request("https://example.com/agency/dashboard", { headers: { Cookie: cookie } });
    expect(await requireAgencyUser(request)).toBe(user);
  });
});

describe("requireAgencyClientAccess", () => {
  const owner = { id: "user-1", agencyId: "agency-1", role: "owner" };
  const staff = { id: "user-2", agencyId: "agency-1", role: "staff" };

  it("throws 404 when the shop isn't linked to the agency at all", async () => {
    vi.mocked(db.agencyClientLink.findFirst).mockResolvedValue(null);
    await expect(requireAgencyClientAccess(owner, "shop-1")).rejects.toMatchObject({ status: 404 });
  });

  it("lets an owner through without an explicit AgencyUserClientAccess row", async () => {
    const link = { id: "link-1" };
    vi.mocked(db.agencyClientLink.findFirst).mockResolvedValue(link as never);

    expect(await requireAgencyClientAccess(owner, "shop-1")).toBe(link);
    expect(db.agencyUserClientAccess.findUnique).not.toHaveBeenCalled();
  });

  it("throws 403 for staff with no explicit access row", async () => {
    vi.mocked(db.agencyClientLink.findFirst).mockResolvedValue({ id: "link-1" } as never);
    vi.mocked(db.agencyUserClientAccess.findUnique).mockResolvedValue(null);

    await expect(requireAgencyClientAccess(staff, "shop-1")).rejects.toMatchObject({ status: 403 });
  });

  it("lets staff through when an explicit access row exists", async () => {
    const link = { id: "link-1" };
    vi.mocked(db.agencyClientLink.findFirst).mockResolvedValue(link as never);
    vi.mocked(db.agencyUserClientAccess.findUnique).mockResolvedValue({ id: "access-1" } as never);

    expect(await requireAgencyClientAccess(staff, "shop-1")).toBe(link);
  });
});
