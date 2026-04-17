// SSRF protection: validate upstream URLs before use

import { lookup } from "node:dns/promises";

/**
 * Hostnames that are always forbidden regardless of IP resolution.
 * These are GCP/AWS metadata endpoints reachable by hostname alone.
 */
const FORBIDDEN_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
]);

/**
 * The literal metadata IP used by AWS EC2, GCP, Azure, and DigitalOcean IMDS.
 * Blocked unconditionally because it is a link-local address in a well-known
 * attack vector.
 */
const METADATA_IP = "169.254.169.254";

/**
 * Private/reserved IPv4 CIDR ranges that are blocked unless allowPrivate is set.
 * Expressed as [network_int, mask_int] pairs for fast bitwise matching.
 */
const PRIVATE_IPV4_RANGES: [number, number][] = [
  // 127.0.0.0/8  — loopback
  [0x7f000000, 0xff000000],
  // 10.0.0.0/8   — RFC-1918
  [0x0a000000, 0xff000000],
  // 172.16.0.0/12 — RFC-1918
  [0xac100000, 0xfff00000],
  // 192.168.0.0/16 — RFC-1918
  [0xc0a80000, 0xffff0000],
  // 169.254.0.0/16 — link-local / IMDS
  [0xa9fe0000, 0xffff0000],
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  // Force unsigned 32-bit
  return result >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  if (ip === METADATA_IP) return true;
  const int = ipv4ToInt(ip);
  if (int === null) return false;
  return PRIVATE_IPV4_RANGES.some(([net, mask]) => (int & mask) === net);
}

function isPrivateIPv6(ip: string): boolean {
  // Strip brackets if present (e.g. "[::1]")
  const clean = ip.replace(/^\[|\]$/g, "").toLowerCase();
  // ::1 — loopback
  if (clean === "::1") return true;
  // fe80::/10 — link-local
  if (/^fe[89ab][0-9a-f]:/.test(clean)) return true;
  // fc00::/7 — unique local
  if (/^f[cd][0-9a-f]{2}:/.test(clean)) return true;
  return false;
}

/**
 * Options accepted by validateUpstreamUrl.
 */
export interface UrlSafetyOptions {
  /**
   * Allow loopback addresses (localhost, 127.x.x.x, ::1).
   * Default: false (production-safe).
   */
  allowLoopback?: boolean;
  /**
   * Allow any private/reserved address range.
   * Default: false.  Set to true when ALLOW_PRIVATE_BASE_URL=1.
   */
  allowPrivate?: boolean;
  /**
   * Injectable DNS resolver for unit testing.
   * Receives the hostname and returns an array of resolved addresses.
   * Defaults to node:dns/promises lookup.
   */
  resolveHost?: (hostname: string) => Promise<string[]>;
}

/**
 * Default DNS resolver: uses node:dns lookup, returns the first result.
 */
async function defaultResolveHost(hostname: string): Promise<string[]> {
  try {
    const result = await lookup(hostname, { all: true });
    return result.map((r) => r.address);
  } catch {
    // DNS failure: allow through (best-effort; network may not be ready)
    return [];
  }
}

/**
 * Validate an upstream baseUrl for SSRF safety.
 *
 * Rejects:
 *  - Non-parseable URLs
 *  - Non-https protocol (unless allowLoopback + loopback hostname)
 *  - Known metadata hostnames (metadata.google.internal, etc.)
 *  - Hostnames that resolve to private/reserved/link-local/loopback IPs
 *  - ftp:, file:, and other non-http(s) schemes
 *
 * Respects the ALLOW_PRIVATE_BASE_URL=1 env variable as an opt-in
 * override for local development (sets allowPrivate + allowLoopback).
 *
 * Returns the parsed URL on success; throws on violation.
 */
export async function validateUpstreamUrl(
  urlString: string,
  opts: UrlSafetyOptions = {},
): Promise<URL> {
  // Apply env-level opt-in first
  const envAllow = process.env["ALLOW_PRIVATE_BASE_URL"] === "1";
  const allowLoopback = opts.allowLoopback ?? envAllow;
  const allowPrivate = opts.allowPrivate ?? envAllow;
  const resolveHost = opts.resolveHost ?? defaultResolveHost;

  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error(`SSRF validation: invalid URL ${JSON.stringify(urlString)}`);
  }

  const { protocol, hostname } = url;

  // Reject non-http(s) schemes outright
  if (protocol !== "https:" && protocol !== "http:") {
    throw new Error(
      `SSRF validation: scheme ${JSON.stringify(protocol)} is not allowed; use https:`,
    );
  }

  const isLoopbackHostname =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1";

  // Require https unless:
  //  - allowLoopback is set and hostname is a loopback address, OR
  //  - allowPrivate is set (implies local/dev mode where http is acceptable)
  if (protocol !== "https:") {
    const httpOk = (allowLoopback && isLoopbackHostname) || allowPrivate;
    if (!httpOk) {
      throw new Error(
        `SSRF validation: ${JSON.stringify(urlString)} must use https: (got ${protocol})`,
      );
    }
  }

  // Reject forbidden metadata hostnames
  if (FORBIDDEN_HOSTNAMES.has(hostname.toLowerCase())) {
    throw new Error(
      `SSRF validation: hostname ${JSON.stringify(hostname)} is a forbidden metadata endpoint`,
    );
  }

  // Literal metadata IP
  if (hostname === METADATA_IP) {
    throw new Error(
      `SSRF validation: ${JSON.stringify(hostname)} is the IMDS metadata IP and is always forbidden`,
    );
  }

  // Check if the raw hostname is already a private IP (catches "http://10.0.0.5")
  if (!allowPrivate) {
    if (isPrivateIPv4(hostname)) {
      if (!(allowLoopback && isLoopbackHostname)) {
        throw new Error(
          `SSRF validation: ${JSON.stringify(hostname)} is a private/reserved IPv4 address`,
        );
      }
    }
    if (isPrivateIPv6(hostname)) {
      if (!allowLoopback) {
        throw new Error(
          `SSRF validation: ${JSON.stringify(hostname)} is a private/reserved IPv6 address`,
        );
      }
    }
  }

  // DNS resolution check: resolve the hostname and verify no address lands in a
  // private range (defends against DNS rebinding if checked at connect time).
  if (!allowPrivate) {
    const addresses = await resolveHost(hostname);
    for (const addr of addresses) {
      const isLoopbackAddr =
        addr === "127.0.0.1" || addr === "::1" || addr.startsWith("127.");
      if (isLoopbackAddr && allowLoopback) continue;
      if (isPrivateIPv4(addr) || isPrivateIPv6(addr)) {
        throw new Error(
          `SSRF validation: ${JSON.stringify(hostname)} resolves to private/reserved address ${JSON.stringify(addr)}`,
        );
      }
    }
  }

  return url;
}
