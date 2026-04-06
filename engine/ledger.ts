import fs from "fs-extra";
import path from "path";

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
};

const LEDGER_PATH = path.join(process.cwd(), "reports", "ledger.json");

// In-memory session ledger
const sessionEntries: LedgerEntry[] = [];

export async function recordEntry(entry: LedgerEntry): Promise<void> {
  sessionEntries.push(entry);

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

  existing.push(entry);
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
  };

  for (const entry of entries) {
    summary.totalTokensIn += entry.tokensIn ?? 0;
    summary.totalTokensOut += entry.tokensOut ?? 0;
    summary.totalEstimatedCostUsd += entry.estimatedCostUsd ?? 0;
    summary.totalDurationMs += entry.durationMs;

    // Model breakdown
    const modelKey = entry.model ?? "unknown";
    if (!summary.modelBreakdown[modelKey]) {
      summary.modelBreakdown[modelKey] = { count: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
    }
    summary.modelBreakdown[modelKey].count++;
    summary.modelBreakdown[modelKey].tokensIn += entry.tokensIn ?? 0;
    summary.modelBreakdown[modelKey].tokensOut += entry.tokensOut ?? 0;
    summary.modelBreakdown[modelKey].costUsd += entry.estimatedCostUsd ?? 0;

    // Provider breakdown
    const providerKey = entry.provider ?? "unknown";
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
