import { URL } from "url";
import type { ArmoryExecutionTier, ArmoryRunRequest, ArmoryTarget } from "./armory";

const PRIVATE_IPV4_PATTERNS = [
  /^10\.(\d{1,3}\.){2}\d{1,3}$/,
  /^192\.168\.(\d{1,3})\.(\d{1,3})$/,
  /^172\.(1[6-9]|2\d|3[0-1])\.(\d{1,3})\.(\d{1,3})$/,
];

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const SAFE_HTTP_PROTOCOLS = new Set(["http:", "https:"]);

export const EXECUTION_TIERS: ArmoryExecutionTier[] = [0, 1, 2, 3];
export const DEFAULT_EXECUTION_TIER: ArmoryExecutionTier = 1;

export function normalizeExecutionTier(value: unknown): ArmoryExecutionTier {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? DEFAULT_EXECUTION_TIER), 10);
  if (EXECUTION_TIERS.includes(parsed as ArmoryExecutionTier)) return parsed as ArmoryExecutionTier;
  throw new Error("Invalid safety level. Use 0, 1, 2, or 3.");
}

function isIpv4OctetSafe(value: string): boolean {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255;
}

function isPrivateIpv4(hostname: string): boolean {
  if (!hostname.includes(".")) return false;
  const octets = hostname.split(".");
  if (octets.length !== 4 || octets.some((part) => !isIpv4OctetSafe(part))) return false;
  return PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(hostname));
}

function isValidIpv4(hostname: string): boolean {
  if (!hostname.includes(".")) return false;
  const octets = hostname.split(".");
  return octets.length === 4 && octets.every((part) => isIpv4OctetSafe(part));
}

export function isBeginnerSafeHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return LOCAL_HOSTNAMES.has(normalized) || isPrivateIpv4(normalized);
}

function parseLocalPortTarget(input: string): ArmoryTarget {
  const match = input.trim().match(/^localhost:(\d{1,5})$/i);
  if (!match) {
    throw new Error("Local port targets must use the format localhost:3000.");
  }

  const port = Number.parseInt(match[1], 10);
  if (port < 1 || port > 65535) {
    throw new Error("Port must be between 1 and 65535.");
  }

  return {
    kind: "local-port",
    display: `localhost:${port}`,
    host: "localhost",
    port,
    url: `http://localhost:${port}`,
    beginnerSafe: true,
  };
}

function parseIpTarget(input: string): ArmoryTarget {
  const candidate = input.trim();
  if (!candidate.match(/^[a-zA-Z0-9.\-:]+$/)) {
    throw new Error("Target contains unsupported characters.");
  }

  const hasPort = candidate.includes(":") && !candidate.includes("://");
  const parts = candidate.split(":");
  if (hasPort && parts.length !== 2) {
    throw new Error("Only IPv4 targets with an optional single port are supported.");
  }
  const host = hasPort ? parts[0] : candidate;
  const port = hasPort ? Number.parseInt(parts[1], 10) : undefined;

  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error("Port must be between 1 and 65535.");
  }

  const normalizedHost = host.trim().toLowerCase();
  if (!LOCAL_HOSTNAMES.has(normalizedHost) && !isValidIpv4(normalizedHost)) {
    throw new Error("Target must be localhost, an IPv4 address, or an http/https URL.");
  }

  if (!isBeginnerSafeHost(normalizedHost)) {
    return {
      kind: "ip",
      display: candidate,
      host: normalizedHost,
      port,
      beginnerSafe: false,
    };
  }

  return {
    kind: "ip",
    display: candidate,
    host: normalizedHost,
    port,
    beginnerSafe: true,
    url: port ? `http://${normalizedHost}:${port}` : `http://${normalizedHost}`,
  };
}

function parseUrlTarget(input: string): ArmoryTarget {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("URL target is invalid.");
  }

  if (!SAFE_HTTP_PROTOCOLS.has(url.protocol)) {
    throw new Error("Only http:// and https:// targets are allowed.");
  }

  return {
    kind: "url",
    display: url.toString(),
    host: url.hostname,
    port: url.port ? Number.parseInt(url.port, 10) : undefined,
    url: url.toString(),
    beginnerSafe: isBeginnerSafeHost(url.hostname),
  };
}

export function parseTargetInput(input: unknown): ArmoryTarget {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("A target is required.");
  }

  const trimmed = input.trim();
  if (/^localhost:\d{1,5}$/i.test(trimmed)) return parseLocalPortTarget(trimmed);
  if (/^https?:\/\//i.test(trimmed)) return parseUrlTarget(trimmed);
  return parseIpTarget(trimmed);
}

export function assertRunIsSafe(request: ArmoryRunRequest, target: ArmoryTarget, tier: ArmoryExecutionTier): void {
  if (!target.beginnerSafe && !request.advancedMode) {
    throw new Error("Beginner guardrails block non-local targets. Enable Advanced Mode to continue.");
  }

  if (tier === 3 && request.unlockAggressive !== true) {
    throw new Error("Level 3 is locked. Explicit unlock is required.");
  }
}

export function explainSafetyLevel(level: ArmoryExecutionTier): string {
  switch (level) {
    case 0:
      return "Passive only. No target interaction is allowed.";
    case 1:
      return "Safe active probing only. Beginner-safe defaults stay enabled.";
    case 2:
      return "Controlled attack mode. Probing stays limited and non-destructive.";
    case 3:
      return "Aggressive mode. Locked by default and should be used only with explicit approval.";
    default:
      return "Unknown safety level.";
  }
}
