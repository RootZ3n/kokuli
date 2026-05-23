/**
 * Verum's CLI-side network gate.
 *
 * The Armory web UI gate (server/ops/safety.ts + armory.ts) was already
 * enforcing VERUM_ENABLE_NETWORK_OPS + ownership confirmation. The CLI
 * path (engine/cli.ts → engine/client.ts) was NOT — it would happily
 * make outbound axios requests to whatever URL appeared in a target
 * config. This module closes that hole.
 *
 * Default policy:
 *   - Local / private / lab targets (loopback, RFC1918, RFC6598/CGNAT,
 *     IPv6 ULA + link-local, *.local mDNS) are allowed.
 *   - Any other host is treated as "public" and refused unless the
 *     operator has set BOTH:
 *         VERUM_ENABLE_NETWORK_OPS=1
 *         VERUM_OWNERSHIP_CONFIRMED=1
 *   - VERUM_NETWORK_BYPASS=1 short-circuits the gate (e.g. for tests
 *     that mock the network and never actually leave the host).
 *
 * The dual-env-var contract mirrors the Armory contract intentionally:
 * one flag says "yes I want the network on at all" and the other is
 * the explicit "I own this target" attestation. Two separate flags
 * means a single typo in .env cannot accidentally enable live ops.
 */

const PRIVATE_IPV4_PATTERNS: readonly RegExp[] = [
  /^10\.(\d{1,3}\.){2}\d{1,3}$/, // RFC1918 10/8
  /^192\.168\.\d{1,3}\.\d{1,3}$/, // RFC1918 192.168/16
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/, // RFC1918 172.16/12
  /^127\.(\d{1,3}\.){2}\d{1,3}$/, // loopback /8
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/, // RFC6598 / CGNAT (Tailscale)
  /^169\.254\.\d{1,3}\.\d{1,3}$/, // link-local
];

const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::",
  "::1",
]);

const TRUTHY_ENV: ReadonlySet<string> = new Set([
  "1",
  "true",
  "yes",
  "on",
]);

function envFlag(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined) return false;
  return TRUTHY_ENV.has(raw.trim().toLowerCase());
}

export function isNetworkOpsEnabled(): boolean {
  return envFlag("VERUM_ENABLE_NETWORK_OPS");
}

export function isOwnershipConfirmed(): boolean {
  return envFlag("VERUM_OWNERSHIP_CONFIRMED");
}

function isNetworkBypass(): boolean {
  // Only honored under NODE_ENV=test to keep production code paths tight.
  // (Tests that need to run real-but-offline integrations can opt in.)
  return process.env.NODE_ENV === "test" && envFlag("VERUM_NETWORK_BYPASS");
}

export function isPrivateOrLocalHostname(hostname: string): boolean {
  if (!hostname) return false;
  // Strip IPv6 brackets and any zone-id suffix.
  const stripped = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/%[^.]*$/, "");

  if (LOCAL_HOSTNAMES.has(stripped)) return true;
  if (stripped.endsWith(".local") || stripped.endsWith(".local.")) return true; // mDNS
  if (stripped.endsWith(".localhost")) return true; // RFC 6761 reserved suffix
  // IPv6 loopback / ULA (fc00::/7) / link-local (fe80::/10).
  if (
    stripped === "::1" ||
    stripped.startsWith("fe80:") ||
    /^f[cd][0-9a-f]{2}:/i.test(stripped)
  ) {
    return true;
  }
  return PRIVATE_IPV4_PATTERNS.some((rx) => rx.test(stripped));
}

export interface NetworkGateContext {
  /** Absolute URL (will be parsed). */
  url: string;
  /** Optional human-readable target name for the error message. */
  targetName?: string;
  /** Why this call is being made (used in the error message for clarity). */
  purpose?: string;
}

export class NetworkGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkGateError";
  }
}

/**
 * Throws a NetworkGateError when the target host is non-private and the
 * operator has not opted in via BOTH env flags. Safe targets pass through
 * silently.
 */
export function assertNetworkAllowed(ctx: NetworkGateContext): void {
  if (isNetworkBypass()) return;

  let parsed: URL;
  try {
    parsed = new URL(ctx.url);
  } catch {
    throw new NetworkGateError(
      `[verum] Refusing to make a request — malformed URL '${ctx.url}'.`,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new NetworkGateError(
      `[verum] Refusing to make a request — only http/https are allowed (got '${parsed.protocol}').`,
    );
  }

  const host = parsed.hostname;
  if (isPrivateOrLocalHostname(host)) return;

  const network = isNetworkOpsEnabled();
  const ownership = isOwnershipConfirmed();
  if (network && ownership) return;

  const missing: string[] = [];
  if (!network) missing.push("VERUM_ENABLE_NETWORK_OPS=1");
  if (!ownership) missing.push("VERUM_OWNERSHIP_CONFIRMED=1");

  const label = ctx.targetName ? `${ctx.targetName} (${host})` : host;
  const purpose = ctx.purpose ? ` for ${ctx.purpose}` : "";
  throw new NetworkGateError(
    `[verum] Refusing to send a public-target request${purpose} to '${label}'. ` +
      `Verum gates outbound network ops by default. To enable, set: ${missing.join(" and ")}, ` +
      `and confirm you own the target. Local lab IPs (loopback, RFC1918, RFC6598/CGNAT, *.local) are always allowed.`,
  );
}

/**
 * Convenience predicate — returns true if the URL would be allowed RIGHT NOW
 * given current env. Useful for printing pre-flight warnings.
 */
export function wouldBeAllowed(url: string): boolean {
  try {
    assertNetworkAllowed({ url });
    return true;
  } catch {
    return false;
  }
}
