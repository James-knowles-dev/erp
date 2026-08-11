import dns from "node:dns/promises";
import net from "node:net";

// Guards against SSRF via merchant-supplied ERP base URLs (Acumatica's instanceUrl, Sage 300's
// serverUrl -- both collected as free text in the wizard, see registry.server.ts's
// ConnectFormField "url" type) and agency-supplied webhook subscription URLs (api.webhooks.tsx).
// Both classes get fetched server-side with a bearer/basic-auth header attached, so an
// unvalidated host lets a merchant or agency point our server at internal infrastructure --
// cloud metadata endpoints (169.254.169.254) in particular.
//
// This resolves DNS at validation time, which is NOT rebinding-safe on its own -- the resolved
// address could differ at actual fetch time. Closing that fully needs resolving once and
// connecting directly to the resolved IP (e.g. a custom fetch agent / dispatcher), which is real
// follow-up work (erp-connector-fixes-spec.md F3), not done here. This still blocks the common
// case -- an obviously private hostname or IP literal -- without rewriting the HTTP client in
// six adapters plus the webhook dispatcher.

const BLOCKED_HOSTNAMES = new Set(["localhost"]);
const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".internal", ".localdomain"];

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true; // loopback / unspecified
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return true; // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true; // fc00::/7 unique local
  if (normalized.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 address -- unwrap and check the embedded IPv4 address.
    return isPrivateIPv4(normalized.slice("::ffff:".length));
  }
  return false;
}

function isPrivateIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return false;
}

export interface UrlSafetyResult {
  valid: boolean;
  reason?: string;
}

export async function validateExternalUrl(rawUrl: string): Promise<UrlSafetyResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { valid: false, reason: "Not a valid URL." };
  }

  if (url.protocol !== "https:") {
    return { valid: false, reason: "URL must use https://." };
  }

  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return { valid: false, reason: "URL must not point at a local or internal hostname." };
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      return { valid: false, reason: "URL must not point at a private or internal IP address." };
    }
    return { valid: true };
  }

  try {
    const { address } = await dns.lookup(hostname);
    if (isPrivateIp(address)) {
      return { valid: false, reason: "URL's hostname resolves to a private or internal IP address." };
    }
  } catch {
    return { valid: false, reason: "Could not resolve URL's hostname." };
  }

  return { valid: true };
}
