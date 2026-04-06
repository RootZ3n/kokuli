import fs from "fs-extra";
import path from "path";
import { z, ZodError } from "zod";
import {
  PayloadFormat,
  ResolvedTargetConfig,
  TargetAuthConfig,
  TargetConfig,
  TargetConfigSnapshot,
  TargetEndpointConfig,
  TargetEndpointKey,
  TargetPathMode,
  TargetsFile,
} from "./types";

export const TARGET_ENDPOINT_KEYS: TargetEndpointKey[] = [
  "chat",
  "health",
  "search",
  "memory",
  "receipts",
  "runs",
  "sessions",
  "tools",
  "version",
  "approvals",
  "magister",
  "root",
];

export const DEFAULT_ENDPOINT_PATHS: Record<TargetEndpointKey, string> = {
  chat: "/chat",
  health: "/health",
  search: "/search",
  memory: "/memory/search",
  receipts: "/receipts",
  runs: "/runs",
  sessions: "/sessions",
  tools: "/tools/list",
  version: "/version",
  approvals: "/approvals",
  magister: "/magister/modules",
  root: "/",
};

const targetConfigSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),
  name: z.string().trim().min(1).max(120),
  baseUrl: z.string().trim().url(),
  payloadFormat: z.enum(["messages", "input"]).default("messages"),
  chatPath: z.string().trim().optional(),
  pathMode: z.enum(["explicit_only", "explicit_plus_defaults"]).default("explicit_plus_defaults"),
  endpoints: z.object({
    chat: z.string().trim().optional(),
    health: z.string().trim().optional(),
    search: z.string().trim().optional(),
    memory: z.string().trim().optional(),
    receipts: z.string().trim().optional(),
    runs: z.string().trim().optional(),
    sessions: z.string().trim().optional(),
    tools: z.string().trim().optional(),
    version: z.string().trim().optional(),
    approvals: z.string().trim().optional(),
    magister: z.string().trim().optional(),
    root: z.string().trim().optional(),
  }).partial().default({}),
  auth: z.object({
    headerName: z.string().trim().optional(),
    token: z.string().optional(),
  }).partial().default({}),
  notes: z.string().trim().optional(),
  enabled: z.boolean().default(true),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const createTargetRequestSchema = targetConfigSchema.extend({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
});

const updateTargetRequestSchema = targetConfigSchema.partial();

const TARGET_FIELD_LABELS: Record<string, string> = {
  id: "target id",
  name: "target name",
  baseUrl: "base URL",
  payloadFormat: "payload format",
  pathMode: "path mode",
  "auth.headerName": "auth header name",
  "auth.token": "auth token",
};

export function targetsPath(): string {
  return process.env.KRAKZEN_TARGETS_PATH || path.join(process.cwd(), "config", "targets.json");
}

export function sanitizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function formatTargetValidationError(error: unknown): string {
  if (!(error instanceof ZodError)) {
    return error instanceof Error ? error.message : String(error);
  }
  const issues = error.issues.map((issue) => {
    const path = issue.path.join(".");
    const label = TARGET_FIELD_LABELS[path] || path || "target configuration";
    if (issue.code === "invalid_type" && issue.received === "undefined") {
      return `${label} is required`;
    }
    if (path === "baseUrl" && issue.code === "invalid_string") {
      return "base URL must be a valid URL";
    }
    return `${label}: ${issue.message}`;
  });
  return `Target validation failed: ${issues.join("; ")}`;
}

export function normalizeTargetDraft(input: Partial<TargetConfig & { id: string }>, options?: { requireId?: boolean; partial?: boolean }): Partial<TargetConfig & { id: string }> {
  const normalizedId = typeof input.id === "string" ? input.id.trim() : undefined;
  const cleanedEndpoints = Object.entries(input.endpoints || {}).reduce<TargetEndpointConfig>((acc, [key, value]) => {
    const normalized = normalizeEndpointPath(typeof value === "string" ? value : undefined);
    if (normalized) acc[key as TargetEndpointKey] = normalized;
    return acc;
  }, {});
  const headerName = input.auth?.headerName?.trim() || undefined;
  const token = typeof input.auth?.token === "string" ? input.auth.token : undefined;
  const normalized: Partial<TargetConfig & { id: string }> = {
    id: normalizedId,
    name: input.name?.trim() || "",
    baseUrl: input.baseUrl?.trim() || "",
    payloadFormat: input.payloadFormat || "messages",
    chatPath: typeof input.chatPath === "string" ? input.chatPath.trim() : undefined,
    pathMode: input.pathMode || "explicit_plus_defaults",
    endpoints: cleanedEndpoints,
    auth: {
      headerName,
      token: token && token.trim() ? token : undefined,
    },
    notes: input.notes?.trim() || undefined,
    enabled: input.enabled !== false,
  };
  if (!normalized.auth?.headerName && !normalized.auth?.token) delete normalized.auth;
  if (!normalized.notes) delete normalized.notes;
  if (!normalized.endpoints || Object.keys(normalized.endpoints).length === 0) delete normalized.endpoints;
  if (!options?.requireId && !normalized.id) delete normalized.id;
  if (options?.partial) {
    if (input.name == null) delete normalized.name;
    if (input.baseUrl == null) delete normalized.baseUrl;
    if (input.payloadFormat == null) delete normalized.payloadFormat;
    if (input.chatPath == null) delete normalized.chatPath;
    if (input.pathMode == null) delete normalized.pathMode;
    if (input.notes == null) delete normalized.notes;
    if (input.enabled == null) delete normalized.enabled;
    if (input.endpoints == null) delete normalized.endpoints;
    if (input.auth == null) delete normalized.auth;
  }
  return normalized;
}

export function normalizeEndpointPath(rawPath?: string): string | undefined {
  if (rawPath == null) return undefined;
  const trimmed = rawPath.trim();
  if (!trimmed) return undefined;
  if (trimmed === "/") return "/";
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

function normalizeEndpoints(endpoints?: TargetEndpointConfig, legacyChatPath?: string): TargetEndpointConfig {
  const next: TargetEndpointConfig = {};
  for (const key of TARGET_ENDPOINT_KEYS) {
    const rawPath = key === "chat" && !endpoints?.chat ? legacyChatPath : endpoints?.[key];
    const normalized = normalizeEndpointPath(rawPath);
    if (normalized) next[key] = normalized;
  }
  return next;
}

function normalizeAuth(auth?: TargetAuthConfig): TargetAuthConfig {
  return {
    headerName: auth?.headerName?.trim() || undefined,
    token: auth?.token ? String(auth.token) : undefined,
  };
}

export function normalizeTargetConfig(id: string, input: TargetConfig, existing?: TargetConfig): TargetConfig {
  const draft = normalizeTargetDraft({
    ...input,
    id,
    auth: {
      headerName: input.auth?.headerName,
      token: input.auth?.token && input.auth.token.trim() ? input.auth.token : existing?.auth?.token,
    },
  }, { requireId: true });
  const parsed = targetConfigSchema.parse(draft);
  const now = new Date().toISOString();
  const normalizedEndpoints = normalizeEndpoints(parsed.endpoints, parsed.chatPath);
  return {
    id,
    name: parsed.name.trim(),
    baseUrl: sanitizeBaseUrl(parsed.baseUrl),
    payloadFormat: parsed.payloadFormat,
    chatPath: normalizedEndpoints.chat,
    pathMode: parsed.pathMode,
    endpoints: normalizedEndpoints,
    auth: normalizeAuth(parsed.auth),
    notes: parsed.notes?.trim() || undefined,
    enabled: parsed.enabled,
    createdAt: parsed.createdAt || existing?.createdAt || now,
    updatedAt: now,
  };
}

export function normalizeTargetsFile(data: TargetsFile): TargetsFile {
  const normalizedTargets = Object.entries(data.targets || {}).reduce<Record<string, TargetConfig>>((acc, [id, target]) => {
    acc[id] = normalizeTargetConfig(id, target);
    return acc;
  }, {});
  const defaultTarget = normalizedTargets[data.defaultTarget] ? data.defaultTarget : Object.keys(normalizedTargets)[0] || "";
  return {
    defaultTarget,
    targets: normalizedTargets,
    endpoints: data.endpoints,
  };
}

export async function loadTargets(): Promise<TargetsFile> {
  const file = await fs.readJson(targetsPath()) as TargetsFile;
  return normalizeTargetsFile(file);
}

export async function saveTargets(data: TargetsFile): Promise<void> {
  await fs.writeJson(targetsPath(), normalizeTargetsFile(data), { spaces: 2 });
}

export function resolveTargetEndpoints(target: TargetConfig): TargetEndpointConfig {
  const normalized = normalizeTargetConfig(target.id || "temporary-target", target);
  const resolved: TargetEndpointConfig = {};
  for (const key of TARGET_ENDPOINT_KEYS) {
    const explicit = normalized.endpoints?.[key];
    if (explicit) {
      resolved[key] = explicit;
      continue;
    }
    if (normalized.pathMode === "explicit_plus_defaults") {
      resolved[key] = DEFAULT_ENDPOINT_PATHS[key];
    }
  }
  return resolved;
}

export function resolveExecutionTarget(args: {
  id: string;
  target: TargetConfig;
  source: "saved" | "temporary";
}): ResolvedTargetConfig {
  const normalized = normalizeTargetConfig(args.id, args.target);
  return {
    ...normalized,
    id: args.id,
    pathMode: normalized.pathMode || "explicit_plus_defaults",
    endpoints: normalized.endpoints || {},
    resolvedEndpoints: resolveTargetEndpoints(normalized),
    auth: normalizeAuth(normalized.auth),
    enabled: normalized.enabled !== false,
    source: args.source,
  };
}

export function snapshotTargetConfig(target: ResolvedTargetConfig): TargetConfigSnapshot {
  return {
    id: target.id,
    name: target.name,
    baseUrl: target.baseUrl,
    source: target.source,
    pathMode: target.pathMode,
    payloadFormat: target.payloadFormat,
    enabled: target.enabled,
    auth: {
      headerName: target.auth.headerName,
      hasToken: Boolean(target.auth.token),
    },
    resolvedEndpoints: { ...target.resolvedEndpoints },
    notes: target.notes,
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
  };
}

export function redactTargetSecrets(target: TargetConfig): TargetConfig & { auth?: { headerName?: string; hasToken: boolean } } {
  return {
    ...target,
    auth: target.auth ? {
      headerName: target.auth.headerName,
      hasToken: Boolean(target.auth.token),
    } : undefined,
  };
}

export async function getTargetById(id: string): Promise<TargetConfig> {
  const data = await loadTargets();
  const target = data.targets[id];
  if (!target) throw new Error(`Target '${id}' not found.`);
  return target;
}

export async function createTarget(input: TargetConfig & { id: string }): Promise<TargetConfig> {
  const parsed = createTargetRequestSchema.parse(normalizeTargetDraft(input, { requireId: true }));
  const data = await loadTargets();
  if (data.targets[parsed.id]) throw new Error(`Target '${parsed.id}' already exists.`);
  const target = normalizeTargetConfig(parsed.id, parsed);
  data.targets[parsed.id] = target;
  if (!data.defaultTarget) data.defaultTarget = parsed.id;
  await saveTargets(data);
  return target;
}

export async function addTarget(id: string, target: TargetConfig): Promise<void> {
  await createTarget({ ...target, id });
}

export async function updateTarget(id: string, updates: Partial<TargetConfig>): Promise<TargetConfig> {
  updateTargetRequestSchema.parse(normalizeTargetDraft({ ...updates, id }, { requireId: false, partial: true }));
  const data = await loadTargets();
  const existing = data.targets[id];
  if (!existing) throw new Error(`Target '${id}' not found.`);
  const merged = normalizeTargetConfig(id, {
    ...existing,
    ...updates,
    auth: {
      ...(existing.auth || {}),
      ...(updates.auth || {}),
    },
    endpoints: {
      ...(existing.endpoints || {}),
      ...(updates.endpoints || {}),
    },
  }, existing);
  data.targets[id] = merged;
  await saveTargets(data);
  return merged;
}

export async function deleteTarget(id: string): Promise<void> {
  const data = await loadTargets();
  if (!data.targets[id]) throw new Error(`Target '${id}' not found.`);
  if (data.defaultTarget === id) throw new Error(`Cannot remove the active target '${id}'. Switch to another target first.`);
  delete data.targets[id];
  await saveTargets(data);
}

export async function removeTarget(id: string): Promise<void> {
  await deleteTarget(id);
}

export async function setActiveTarget(id: string): Promise<TargetConfig> {
  const data = await loadTargets();
  if (!data.targets[id]) throw new Error(`Unknown target '${id}'.`);
  data.defaultTarget = id;
  await saveTargets(data);
  return data.targets[id];
}

export async function getActiveTarget(): Promise<{ key: string; target: ResolvedTargetConfig }> {
  const data = await loadTargets();
  const key = data.defaultTarget;
  const target = data.targets[key];
  if (!target) throw new Error(`Active target '${key}' not found in targets.json.`);
  return { key, target: resolveExecutionTarget({ id: key, target, source: "saved" }) };
}

export async function resolveTarget(overrideKey?: string): Promise<{ key: string; target: ResolvedTargetConfig }> {
  const data = await loadTargets();
  const key = overrideKey ?? data.defaultTarget;
  const target = data.targets[key];
  if (!target) throw new Error(`Target '${key}' not found. Available: ${Object.keys(data.targets).join(", ")}`);
  return { key, target: resolveExecutionTarget({ id: key, target, source: "saved" }) };
}

export function resolveTemporaryTarget(input: TargetConfig): ResolvedTargetConfig {
  const id = input.id || `temporary-${Date.now()}`;
  return resolveExecutionTarget({ id, target: input, source: "temporary" });
}

export function resolvePathForAlias(target: ResolvedTargetConfig, key: TargetEndpointKey): string | undefined {
  return target.resolvedEndpoints[key];
}

export function mapPathToAlias(rawPath?: string): TargetEndpointKey | undefined {
  const normalized = normalizeEndpointPath(rawPath);
  if (!normalized) return undefined;
  return TARGET_ENDPOINT_KEYS.find((key) => DEFAULT_ENDPOINT_PATHS[key] === normalized);
}

export function resolveRequestPath(target: ResolvedTargetConfig, rawPath?: string): { path?: string; alias?: TargetEndpointKey; skipped: boolean } {
  const alias = mapPathToAlias(rawPath);
  if (!alias) {
    return { path: normalizeEndpointPath(rawPath), skipped: false };
  }
  const resolved = resolvePathForAlias(target, alias);
  if (!resolved) {
    return { alias, skipped: true };
  }
  return { path: resolved, alias, skipped: false };
}
