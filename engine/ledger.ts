/**
 * Kokuli — Ledger
 * Append-only record of all Kokuli Bridge requests and their outcomes.
 *
 * Retention policy:
 * - LEDGER_MAX_ENTRIES (default 10 000): cap the ledger; oldest entries pruned first
 * - LEDGER_RETENTION_DAYS (default 90): entries older than this are deleted on next write
 *
 * Override with env vars LEDGER_MAX_ENTRIES and LEDGER_RETENTION_DAYS.
 */

import fs from "fs-extra";
import path from "path";

// Bumped from 1 (implicit) when honesty-flagged entries were introduced.
// Entries without `schemaVersion` are pre-honesty-flag and treated as HISTORICAL.
export const LEDGER_SCHEMA_VERSION = 2;

export type LedgerEntry = {
  id: string;                    // unique entry ID (timestamp + test ID)
  timestamp: string;             // ISO timestamp
  testId: string;                // test that triggered this
  target: string;                // target key
  endpoint: string;              // endpoint hit
  method: string;                // HTTP method
  // Response transparency
  model?: string;                // AI model used
  provider?: string;             // provider that handled it
  tokensIn?: number;             // input tokens
  tokensOut?: number;            // output tokens
  estimatedCostUsd?: number;     // estimated cost
  durationMs: number;            // total request time
  serverDurationMs?: number;     // server-side processing time
  // Routing
  tier?: string;                 // task type/tier
  receiptId?: string;            // routing decision ID
  modelRole?: string;            // model role designation
  escalated?: boolean;           // was request escalated
  // Result
  httpStatus: number;
  result: "PASS" | "FAIL" | "WARN" | "PENDING";
  gatewayBlocked: boolean;
  // --- Honesty metadata (schemaVersion >= 2) ---
  /** Schema marker. Entries without this are HISTORICAL — pre-honesty-flag pipeline. */
  schemaVersion?: number;
  /** Computed at write time: true when receipt did not report a provider. */
  unknownProvider?: boolean;
  /** Computed at write time: true when receipt did not report a model. */
  unknownModel?: boolean;
  /** Computed at write time: true when receipt did not include cost telemetry. */
  unknownCost?: boolean;
  /** Optional honesty chip list (lifted from the corresponding TestResult). */
  honestyFlags?: string[];
};

export type LedgerSummary = {
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalEstimatedCostUsd: number;
  totalDurationMs: number;
  modelBreakdown: Record<string, { count: number; tokensIn: number; tokensOut: number; costUsd: number }>;
  providerBreakdown: Record<string, { count: number; tokensIn: number; tokensOut: number; costUsd: number }>;
  resultBreakdown: { pass: number; fail: number; warn: number };
  targetBreakdown: Record<string, number>;
  // --- Honesty rollups ---
  historicalCount: number;       // entries without schemaVersion (pre-honesty-flag pipeline)
  currentSchemaCount: number;    // entries written by the post-audit pipeline
  unknownProviderCurrent: number;// CURRENT entries that lacked a provider — operator-visible problem
  unknownProviderHistorical: number; // HISTORICAL entries that lacked a provider — informational
  unknownModelCurrent: number;
  unknownModelHistorical: number;
};

function ledgerPath(): string {
  return path.join(process.cwd(), "reports", "ledger.json");
}

// Retention caps (H1/H2). Read from env each time so tests can override.
function maxEntries(): number {
  const raw = Number.parseInt(process.env.LEDGER_MAX_ENTRIES ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 10_000;
}
function retentionDays(): number {
  const raw = Number.parseInt(process.env.LEDGER_RETENTION_DAYS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 90;
}

// In-memory session ledger, hydrated from disk on first access (loadLedger).
const sessionEntries: LedgerEntry[] = [];
let loaded = false;

/** Parse a ledger file that is either legacy JSON array or JSONL (one entry/line). */
function parseLedgerRaw(raw: string): { entries: LedgerEntry[]; wasLegacyArray: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { entries: [], wasLegacyArray: false };
  if (trimmed.startsWith("[")) {
    // Legacy format: a single JSON array. Converted to JSONL on first load.
    try {
      const arr = JSON.parse(trimmed) as unknown;
      return { entries: Array.isArray(arr) ? (arr as LedgerEntry[]) : [], wasLegacyArray: true };
    } catch {
      return { entries: [], wasLegacyArray: true };
    }
  }
  const entries: LedgerEntry[] = [];
  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    try {
      entries.push(JSON.parse(l) as LedgerEntry);
    } catch {
      // Skip a malformed/torn line rather than failing the whole load.
    }
  }
  return { entries, wasLegacyArray: false };
}

/** Enforce the documented retention caps: drop entries past the age window, then cap count. */
function pruneEntries(entries: LedgerEntry[]): LedgerEntry[] {
  const cutoff = Date.now() - retentionDays() * 24 * 60 * 60 * 1000;
  const withinWindow = entries.filter((e) => {
    const t = Date.parse(e.timestamp);
    return !Number.isFinite(t) || t >= cutoff; // keep entries with unparseable timestamps
  });
  const max = maxEntries();
  return withinWindow.length > max ? withinWindow.slice(withinWindow.length - max) : withinWindow;
}

/** Rewrite the on-disk ledger as JSONL (atomic). */
function writeLedgerJsonl(entries: LedgerEntry[]): void {
  const body = entries.map((e) => JSON.stringify(e)).join("\n");
  const file = ledgerPath();
  fs.ensureDirSync(path.dirname(file));
  // Atomic .tmp + rename so a crash mid-write can't corrupt the ledger (M1).
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, entries.length ? body + "\n" : "");
  fs.renameSync(tmp, file);
}

/**
 * Hydrate `sessionEntries` from disk, enforce caps, and (if needed) convert a
 * legacy JSON-array file to JSONL or rewrite a pruned file. Idempotent: only
 * the first call reads disk; later calls are no-ops.
 */
export async function loadLedger(): Promise<LedgerEntry[]> {
  if (loaded) return [...sessionEntries];
  const file = ledgerPath();
  if (await fs.pathExists(file)) {
    let parsed: { entries: LedgerEntry[]; wasLegacyArray: boolean };
    try {
      parsed = parseLedgerRaw(await fs.readFile(file, "utf8"));
    } catch {
      parsed = { entries: [], wasLegacyArray: false };
    }
    const pruned = pruneEntries(parsed.entries);
    sessionEntries.length = 0;
    sessionEntries.push(...pruned);
    // Rewrite when we converted a legacy array or actually dropped entries.
    if (parsed.wasLegacyArray || pruned.length !== parsed.entries.length) {
      try {
        writeLedgerJsonl(pruned);
      } catch {
        // Non-fatal: in-memory state is still correct; disk stays as-is.
      }
    }
  }
  loaded = true;
  return [...sessionEntries];
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await loadLedger();
}

export async function recordEntry(entry: LedgerEntry): Promise<void> {
  await ensureLoaded();

  // Stamp every new entry with the current schema version and compute the
  // unknown-provider / unknown-model / unknown-cost honesty flags. Old
  // entries already on disk keep their original shape — they're HISTORICAL.
  const honestyFlags = new Set<string>(entry.honestyFlags ?? []);
  const enriched: LedgerEntry = {
    ...entry,
    schemaVersion: entry.schemaVersion ?? LEDGER_SCHEMA_VERSION,
    unknownProvider: entry.unknownProvider ?? !entry.provider,
    unknownModel: entry.unknownModel ?? !entry.model,
    unknownCost: entry.unknownCost ?? entry.estimatedCostUsd === undefined,
  };
  if (!enriched.provider) honestyFlags.add("UNKNOWN_PROVIDER");
  if (!enriched.model) honestyFlags.add("UNKNOWN_MODEL");
  if (enriched.estimatedCostUsd === undefined) honestyFlags.add("UNKNOWN_COST");
  if (honestyFlags.size > 0) enriched.honestyFlags = Array.from(honestyFlags);

  // H2: keep the in-memory session cache bounded — shift oldest out over cap.
  sessionEntries.push(enriched);
  const max = maxEntries();
  if (sessionEntries.length > max) sessionEntries.splice(0, sessionEntries.length - max);

  // H1: O(1) append instead of read-whole-file + rewrite-whole-file.
  const file = ledgerPath();
  await fs.ensureDir(path.dirname(file));
  await fs.appendFile(file, JSON.stringify(enriched) + "\n");
}

export async function getLedger(): Promise<LedgerEntry[]> {
  await ensureLoaded();
  return [...sessionEntries];
}

export async function getLedgerSummary(): Promise<LedgerSummary> {
  const entries = await getLedger();
  return computeSummary(entries);
}

export type LedgerFilter = {
  result?: "PASS" | "FAIL" | "WARN";
  target?: string;
  dateRange?: {
    from?: string; // ISO date string
    to?: string;   // ISO date string
  };
};

/**
 * Filter ledger entries by an optional result, target, and/or date range.
 * Returns a shallow copy of matching entries (modifying them won't affect the
 * in-memory ledger). All filter fields are optional — omit a field to skip it.
 */
export async function filterLedger(filter: LedgerFilter): Promise<LedgerEntry[]> {
  const entries = await getLedger();
  return entries.filter((entry) => {
    if (filter.result !== undefined && entry.result !== filter.result) return false;
    if (filter.target !== undefined && entry.target !== filter.target) return false;
    if (filter.dateRange) {
      const ts = new Date(entry.timestamp).getTime();
      if (filter.dateRange.from !== undefined && ts < new Date(filter.dateRange.from).getTime()) return false;
      if (filter.dateRange.to !== undefined && ts > new Date(filter.dateRange.to).getTime()) return false;
    }
    return true;
  });
}

/**
 * Get all ledger entries that match a given result (PASS / FAIL / WARN).
 * Returns a shallow copy of matching entries from the session cache.
 */
export async function getEntriesByResult(result: "PASS" | "FAIL" | "WARN"): Promise<LedgerEntry[]> {
  await ensureLoaded();
  return sessionEntries.filter((entry) => entry.result === result);
}

export async function clearLedger(): Promise<void> {
  sessionEntries.length = 0;
  loaded = true;
  const file = ledgerPath();
  if (await fs.pathExists(file)) {
    await fs.writeFile(file, "");
  }
}

export function getSessionLedger(): LedgerEntry[] {
  return [...sessionEntries];
}

// Test-only: reset the lazy-load state between tests.
export function __resetLedgerForTests(): void {
  sessionEntries.length = 0;
  loaded = false;
}

export function isHistoricalLedgerEntry(entry: LedgerEntry): boolean {
  // Entries written by the pre-honesty-flag pipeline don't carry a schema
  // version. They remain visible in transparency reports but are bucketed
  // separately so they cannot contaminate "current" provider/model rollups.
  return entry.schemaVersion === undefined;
}

export type LedgerStats = {
  total: number;
  pass: number;
  fail: number;
  warn: number;
  totalCostUsd: number;
  avgDurationMs: number;
};

/**
 * Compute lightweight statistics over an array of ledger entries.
 * Returns counts (total/pass/fail/warn), total cost in USD, and average
 * duration in milliseconds (0 when entries is empty).
 */
export function getLedgerStats(entries: LedgerEntry[]): LedgerStats {
  let pass = 0;
  let fail = 0;
  let warn = 0;
  let totalCostUsd = 0;
  let totalDurationMs = 0;

  for (const entry of entries) {
    if (entry.result === "PASS") pass++;
    else if (entry.result === "FAIL") fail++;
    else if (entry.result === "WARN") warn++;

    totalCostUsd += entry.estimatedCostUsd ?? 0;
    totalDurationMs += entry.durationMs;
  }

  return {
    total: entries.length,
    pass,
    fail,
    warn,
    totalCostUsd,
    avgDurationMs: entries.length > 0 ? totalDurationMs / entries.length : 0,
  };
}

export function computeSummary(entries: LedgerEntry[]): LedgerSummary {
  const summary: LedgerSummary = {
    totalRequests: entries.length,
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalEstimatedCostUsd: 0,
    totalDurationMs: 0,
    modelBreakdown: {},
    providerBreakdown: {},
    resultBreakdown: { pass: 0, fail: 0, warn: 0 },
    targetBreakdown: {},
    historicalCount: 0,
    currentSchemaCount: 0,
    unknownProviderCurrent: 0,
    unknownProviderHistorical: 0,
    unknownModelCurrent: 0,
    unknownModelHistorical: 0,
  };

  for (const entry of entries) {
    summary.totalTokensIn += entry.tokensIn ?? 0;
    summary.totalTokensOut += entry.tokensOut ?? 0;
    summary.totalEstimatedCostUsd += entry.estimatedCostUsd ?? 0;
    summary.totalDurationMs += entry.durationMs;

    const isHistorical = isHistoricalLedgerEntry(entry);
    if (isHistorical) summary.historicalCount++;
    else summary.currentSchemaCount++;

    // Model breakdown — historical unknowns bucket separately so they don't
    // contaminate the current-schema "unknown" entries (which are a live
    // problem to investigate).
    const modelKey = entry.model
      ? entry.model
      : isHistorical
        ? "unknown (historical)"
        : "unknown (current)";
    if (!entry.model) {
      if (isHistorical) summary.unknownModelHistorical++;
      else summary.unknownModelCurrent++;
    }
    if (!summary.modelBreakdown[modelKey]) {
      summary.modelBreakdown[modelKey] = { count: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
    }
    summary.modelBreakdown[modelKey].count++;
    summary.modelBreakdown[modelKey].tokensIn += entry.tokensIn ?? 0;
    summary.modelBreakdown[modelKey].tokensOut += entry.tokensOut ?? 0;
    summary.modelBreakdown[modelKey].costUsd += entry.estimatedCostUsd ?? 0;

    // Provider breakdown — same historical/current split.
    const providerKey = entry.provider
      ? entry.provider
      : isHistorical
        ? "unknown (historical)"
        : "unknown (current)";
    if (!entry.provider) {
      if (isHistorical) summary.unknownProviderHistorical++;
      else summary.unknownProviderCurrent++;
    }
    if (!summary.providerBreakdown[providerKey]) {
      summary.providerBreakdown[providerKey] = { count: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
    }
    summary.providerBreakdown[providerKey].count++;
    summary.providerBreakdown[providerKey].tokensIn += entry.tokensIn ?? 0;
    summary.providerBreakdown[providerKey].tokensOut += entry.tokensOut ?? 0;
    summary.providerBreakdown[providerKey].costUsd += entry.estimatedCostUsd ?? 0;

    // Result breakdown
    if (entry.result === "PASS") summary.resultBreakdown.pass++;
    else if (entry.result === "FAIL") summary.resultBreakdown.fail++;
    else if (entry.result === "WARN") summary.resultBreakdown.warn++;

    // Target breakdown
    summary.targetBreakdown[entry.target] = (summary.targetBreakdown[entry.target] ?? 0) + 1;
  }

  return summary;
}
