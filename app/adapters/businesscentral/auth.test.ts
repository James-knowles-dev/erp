import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listCompanies } from "./auth.server";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function companiesResponse(value: unknown[]) {
  return { ok: true, json: async () => ({ value }) } as Response;
}

describe("listCompanies", () => {
  it("requests the tenant/environment-scoped companies endpoint with a bearer token", async () => {
    fetchMock.mockResolvedValue(companiesResponse([]));

    await listCompanies("tenant-1", "Production", "token-abc");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.businesscentral.dynamics.com/v2.0/tenant-1/Production/api/v2.0/companies",
      { headers: { Authorization: "Bearer token-abc" } },
    );
  });

  it("prefers displayName but falls back to name when displayName is absent", async () => {
    fetchMock.mockResolvedValue(
      companiesResponse([
        { id: "id-1", name: "CRONUS UK Ltd.", displayName: "CRONUS UK Ltd." },
        { id: "id-2", name: "SecondCo" },
      ]),
    );

    const companies = await listCompanies("tenant-1", "Production", "token-abc");

    expect(companies).toEqual([
      { id: "id-1", name: "CRONUS UK Ltd." },
      { id: "id-2", name: "SecondCo" },
    ]);
  });

  it("returns an empty list when the environment has no companies", async () => {
    fetchMock.mockResolvedValue(companiesResponse([]));

    expect(await listCompanies("tenant-1", "Production", "token-abc")).toEqual([]);
  });

  it("throws with status and body when the request fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => "Unauthorized" } as Response);

    await expect(listCompanies("tenant-1", "Production", "bad-token")).rejects.toThrow(/401.*Unauthorized/);
  });
});
