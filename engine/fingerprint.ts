import crypto from "crypto";
import { sendRequest } from "./client";
import { TargetConfig, TargetFingerprint } from "./types";
import { resolvePathForAlias, TARGET_ENDPOINT_KEYS } from "./targets";

const HEADERS_OF_INTEREST = [
  "server",
  "x-powered-by",
  "via",
  "www-authenticate",
  "content-type",
  "cache-control",
];

function pickHeaders(headers: Record<string, string>): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of HEADERS_OF_INTEREST) {
    const value = headers[name];
    if (value) picked[name] = value;
  }
  return picked;
}

function summarizeAuthPosture(endpoints: TargetFingerprint["reachableEndpoints"]): string {
  const authProtected = endpoints.filter((endpoint) => endpoint.authRequired).length;
  const reachable = endpoints.filter((endpoint) => endpoint.reachable).length;
  const open = endpoints.filter((endpoint) => endpoint.reachable && !endpoint.authRequired).length;
  if (reachable === 0) return "No reachable endpoints discovered during fingerprint capture.";
  if (open === reachable) return `All ${reachable} reachable fingerprinted endpoints responded without authentication.`;
  if (authProtected === reachable) return `All ${reachable} reachable fingerprinted endpoints required authentication.`;
  return `${open} of ${reachable} reachable fingerprinted endpoints responded without authentication; ${authProtected} required auth.`;
}

function detectVersionMetadata(rawText: string): string | undefined {
  const trimmed = rawText.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
}

export async function captureTargetFingerprint(targetKey: string, target: TargetConfig): Promise<TargetFingerprint> {
  const probes = TARGET_ENDPOINT_KEYS
    .map((key) => ({
      key,
      path: resolvePathForAlias(target as never, key),
      label: key.charAt(0).toUpperCase() + key.slice(1),
    }))
    .filter((probe): probe is { key: typeof probe.key; path: string; label: string } => typeof probe.path === "string");
  const endpoints: TargetFingerprint["reachableEndpoints"] = [];
  const mergedHeaders: Record<string, string> = {};
  let versionMetadata: string | undefined;

  for (const probe of probes) {
    try {
      const response = await sendRequest(target.baseUrl, probe.path, "GET", undefined, undefined, 5000);
      const headersOfInterest = pickHeaders(response.headers);
      Object.assign(mergedHeaders, headersOfInterest);
      if (probe.key === "version" && response.ok) {
        versionMetadata = detectVersionMetadata(response.rawText);
      }
      endpoints.push({
        path: probe.path,
        label: probe.label,
        status: response.status,
        bytes: response.rawText.length,
        reachable: response.status > 0,
        authRequired: response.status === 401 || response.status === 403,
        headersOfInterest,
      });
    } catch {
      endpoints.push({
        path: probe.path,
        label: probe.label,
        status: 0,
        bytes: 0,
        reachable: false,
        authRequired: false,
        headersOfInterest: {},
      });
    }
  }

  const signaturePayload = {
    baseUrl: target.baseUrl,
    targetName: target.name,
    reachableEndpoints: endpoints.map((endpoint) => ({
      path: endpoint.path,
      status: endpoint.status,
      authRequired: endpoint.authRequired,
      headersOfInterest: endpoint.headersOfInterest,
    })),
    authPostureSummary: summarizeAuthPosture(endpoints),
    versionMetadata,
    headersOfInterest: mergedHeaders,
  };

  return {
    capturedAt: new Date().toISOString(),
    targetKey,
    targetName: target.name,
    baseUrl: target.baseUrl,
    reachableEndpoints: endpoints,
    authPostureSummary: summarizeAuthPosture(endpoints),
    versionMetadata,
    headersOfInterest: mergedHeaders,
    signature: crypto.createHash("sha1").update(JSON.stringify(signaturePayload)).digest("hex"),
    reachableCount: endpoints.filter((endpoint) => endpoint.reachable).length,
    totalEndpoints: endpoints.length,
  };
}

export function compareFingerprints(current?: TargetFingerprint, previous?: TargetFingerprint) {
  if (!current || !previous) {
    return { comparable: true, changedFields: [] as string[] };
  }

  const changedFields: string[] = [];
  if (current.baseUrl !== previous.baseUrl) changedFields.push("base_url");
  if (current.targetName !== previous.targetName) changedFields.push("target_name");
  if (current.versionMetadata !== previous.versionMetadata) changedFields.push("version_metadata");
  if (current.authPostureSummary !== previous.authPostureSummary) changedFields.push("auth_posture");
  if (current.signature !== previous.signature) changedFields.push("fingerprint_signature");

  const comparable = changedFields.length === 0;
  return {
    comparable,
    previousSignature: previous.signature,
    changedFields,
    warning: comparable ? undefined : `Target fingerprint changed (${changedFields.join(", ")}). Run-to-run comparisons may not be directly comparable.`,
  };
}
