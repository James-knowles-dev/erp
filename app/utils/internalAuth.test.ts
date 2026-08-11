import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkInternalDashboardAuth } from "./internalAuth.server";

const ORIGINAL_TOKEN = process.env.INTERNAL_DASHBOARD_TOKEN;

afterEach(() => {
  process.env.INTERNAL_DASHBOARD_TOKEN = ORIGINAL_TOKEN;
});

describe("checkInternalDashboardAuth", () => {
  it("throws 503 when INTERNAL_DASHBOARD_TOKEN isn't configured", () => {
    delete process.env.INTERNAL_DASHBOARD_TOKEN;
    const request = new Request("https://example.com/internal/status");
    expect(() => checkInternalDashboardAuth(request)).toThrow(expect.objectContaining({ status: 503 }));
  });

  describe("with a configured token", () => {
    beforeEach(() => {
      process.env.INTERNAL_DASHBOARD_TOKEN = "secret-token";
    });

    it("throws 401 when the Authorization header is missing", () => {
      const request = new Request("https://example.com/internal/status");
      expect(() => checkInternalDashboardAuth(request)).toThrow(expect.objectContaining({ status: 401 }));
    });

    it("throws 401 for a wrong token", () => {
      const request = new Request("https://example.com/internal/status", {
        headers: { authorization: "Bearer wrong-token" },
      });
      expect(() => checkInternalDashboardAuth(request)).toThrow(expect.objectContaining({ status: 401 }));
    });

    it("throws 401 for a token that's a prefix/suffix of the real one (length mismatch path)", () => {
      const shorter = new Request("https://example.com/internal/status", {
        headers: { authorization: "Bearer secret-toke" },
      });
      expect(() => checkInternalDashboardAuth(shorter)).toThrow(expect.objectContaining({ status: 401 }));

      const longer = new Request("https://example.com/internal/status", {
        headers: { authorization: "Bearer secret-token-and-more" },
      });
      expect(() => checkInternalDashboardAuth(longer)).toThrow(expect.objectContaining({ status: 401 }));
    });

    it("does not throw for the correct bearer token", () => {
      const request = new Request("https://example.com/internal/status", {
        headers: { authorization: "Bearer secret-token" },
      });
      expect(() => checkInternalDashboardAuth(request)).not.toThrow();
    });
  });
});
