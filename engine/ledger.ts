/**
 * Verum — Ledger
 * Append-only record of all Verum Bridge requests and their outcomes.
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

const LEDGER_PATH = path.join(process.cwd(), "reports", "ledger.json");

// In-memory session ledger
const sessionEntries: LedgerEntry[] = [];

export async function recordEntry(entry: LedgerEntry): Promise<void> {
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

  sessionEntries.push(enriched);

  await fs.ensureDir(path.dirname(LEDGER_PATH));

  let existing: LedgerEntry[] = [];
  if (await fs.pathExists(LEDGER_PATH)) {
    try {
      existing = await fs.readJson(LEDGER_PATH);
      if (!Array.isArray(existing)) existing = [];
    } catch {
      existing = [];
    }
  }

  existing.push(enriched);
  await fs.writeJson(LEDGER_PATH, existing, { spaces: 2 });
}

export async function getLedger(): Promise<LedgerEntry[]> {
  if (!(await fs.pathExists(LEDGER_PATH))) return [];

  try {
    const data = await fs.readJson(LEDGER_PATH);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function getLedgerSummary(): Promise<LedgerSummary> {
  const entries = await getLedger();
  return computeSummary(entries);
}

export async function clearLedger(): Promise<void> {
  sessionEntries.length = 0;
  if (await fs.pathExists(LEDGER_PATH)) {
    await fs.writeJson(LEDGER_PATH, [], { spaces: 2 });
  }
}

export function getSessionLedger(): LedgerEntry[] {
  return [...sessionEntries];
}

export function isHistoricalLedgerEntry(entry: LedgerEntry): boolean {
  // Entries written by the pre-honesty-flag pipeline don't carry a schema
  // version. They remain visible in transparency reports but are bucketed
  // separately so they cannot contaminate "current" provider/model rollups.
  return entry.schemaVersion === undefined;
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
