import { afterEach, describe, expect, it, vi } from "vitest";
import dns from "node:dns/promises";
import { validateExternalUrl } from "./urlSafety.server";

describe("validateExternalUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a normal public https URL", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue({ address: "93.184.216.34", family: 4 });
    const result = await validateExternalUrl("https://erp.example.com/webhooks");
    expect(result).toEqual({ valid: true });
  });

  it("rejects a non-URL string", async () => {
    const result = await validateExternalUrl("not a url");
    expect(result.valid).toBe(false);
  });

  it("rejects http:// (non-https)", async () => {
    const result = await validateExternalUrl("http://erp.example.com/webhooks");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/https/);
  });

  it.each(["ftp://erp.example.com", "file:///etc/passwd"])("rejects non-http(s) scheme %s", async (url) => {
    const result = await validateExternalUrl(url);
    expect(result.valid).toBe(false);
  });

  it("rejects localhost", async () => {
    const result = await validateExternalUrl("https://localhost/webhooks");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/local or internal/);
  });

  it.each([".local", ".internal", ".localdomain"])("rejects hostnames ending in %s", async (suffix) => {
    const result = await validateExternalUrl(`https://box${suffix}/webhooks`);
    expect(result.valid).toBe(false);
  });

  it("rejects the cloud metadata address 169.254.169.254 as an IP literal", async () => {
    const result = await validateExternalUrl("https://169.254.169.254/latest/meta-data");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/private or internal IP/);
  });

  it.each([
    ["10.0.0.5", "10.0.0.0/8"],
    ["127.0.0.1", "loopback"],
    ["172.16.0.1", "172.16.0.0/12"],
    ["172.31.255.255", "172.16.0.0/12 upper bound"],
    ["192.168.1.1", "192.168.0.0/16"],
    ["0.0.0.0", "0.0.0.0/8"],
  ])("rejects private IPv4 literal %s (%s)", async (ip) => {
    const result = await validateExternalUrl(`https://${ip}/webhooks`);
    expect(result.valid).toBe(false);
  });

  it("accepts a public IPv4 literal", async () => {
    const result = await validateExternalUrl("https://93.184.216.34/webhooks");
    expect(result.valid).toBe(true);
  });

  it.each([
    ["::1", "loopback"],
    ["fe80::1", "link-local"],
    ["fc00::1", "unique local"],
    ["::ffff:169.254.169.254", "IPv4-mapped cloud metadata"],
  ])("rejects private IPv6 literal %s (%s)", async (ip) => {
    const result = await validateExternalUrl(`https://[${ip}]/webhooks`);
    expect(result.valid).toBe(false);
  });

  it("rejects a hostname that DNS-resolves to a private IP", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue({ address: "10.0.0.5", family: 4 });
    const result = await validateExternalUrl("https://internal-erp.example.com/webhooks");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/resolves to a private/);
  });

  it("rejects a hostname that fails to resolve", async () => {
    vi.spyOn(dns, "lookup").mockRejectedValue(new Error("ENOTFOUND"));
    const result = await validateExternalUrl("https://does-not-exist.example.com/webhooks");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Could not resolve/);
  });
});
