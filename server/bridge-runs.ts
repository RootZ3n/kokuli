// Read-only reader for reports/bridge/INDEX.jsonl + per-run detail.
//
// This module is the data layer behind GET /api/bridge/runs and
// GET /api/bridge/runs/:runId. It is deliberately read-only — no execution,
// no deletion, no mutation — and aggressively sanitized: forbidden fields
// (`reason`, `stdoutTail`, `stderrTail`, `command`, env, tokens, raw user input)
// are stripped on the way out even if they ever appear in BRIDGE_RESULT.json
// or in a future malformed INDEX line.

import path from "path";
import fs from "fs-extra";

// ── Public types ───────────────────────────────────────────────────────────

export interface BridgeRunRowSummary {
  totalTests: number;
  passed: number;
  failed: number;
  findings: number;
  critical: number;
  high: number;
}

export interface BridgeRunRow {
  runId: string;
  caller: string;
  target: string;
  mode: string;
  suite?: string;
  testId?: string;
  status: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  summary: BridgeRunRowSummary;
  reportDir: string;
  reportPath?: string;
  latestReportPath?: string;
}

export interface BridgeRunListFilters {
  caller?: string;
  status?: string;
  mode?: string;
  suite?: string;
  /** ISO timestamp or relative ("1d", "12h", "30m"). Anything before is dropped. */
  since?: string;
  /** Default 100. Clamped to [1, 500]. */
  limit?: number;
}

export interface BridgeRunListResult {
  rows: BridgeRunRow[];
  malformedCount: number;
  totalRows: number;
  /** True when reports/bridge/INDEX.jsonl does not exist on disk. */
  empty: boolean;
}

export interface BridgeRunDetail {
  row: BridgeRunRow | null;
  files: {
    bridgeResult: boolean;
    assessment: boolean;
    summaryMd: boolean;
    summaryJson: boolean;
    executiveSummaryMd: boolean;
  };
  /** Curated subset of BRIDGE_RESULT.json — never includes `command`. */
  bridgeResult: SanitizedBridgeResult | null;
  /** Curated subset of ASSESSMENT.json — summary fields only, no findings array body. */
  assessmentSummary: SanitizedAssessmentSummary | null;
}

export interface SanitizedBridgeResult {
  runId: string;
  request: {
    caller: string;
    target: string;
    mode: string;
    suite?: string;
    testId?: string;
    /** Length only — reason text is never persisted. */
    reasonLength: number;
    dryRun?: boolean;
  };
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: string;
  summary: BridgeRunRowSummary;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  archive: {
    files: string[];
    missingFiles: string[];
  };
  error?: string;
}

export interface SanitizedAssessmentSummary {
  summary?: { total?: number; pass?: number; fail?: number; warn?: number };
  verdict?: string;
  riskSummary?: {
    overallVerdict?: string;
    highestSeverityObserved?: string;
    exploitableFindingsCount?: number;
    publicExposureFindingsCount?: number;
    childSafetyFailuresCount?: number;
  };
  operatorSummary?: {
    overallVerdict?: string;
    highestSeverity?: string;
    criticalFindingsCount?: number;
    newRegressionsCount?: number;
    publicExposureCount?: number;
    childSafetyFailuresCount?: number;
  };
  findingsCount: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

export const BRIDGE_INDEX_FILE = "reports/bridge/INDEX.jsonl";
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const SINCE_RELATIVE_RE = /^(\d{1,5})\s*([smhd])$/i;

// ── Pure helpers (exported for tests) ──────────────────────────────────────

/**
 * Parse one INDEX.jsonl line into a sanitized row. Returns null on:
 *   - empty / whitespace
 *   - JSON parse failure
 *   - missing required fields (runId, caller, status, startedAt)
 *   - any value that doesn't pass type checks
 *
 * Forbidden fields (reason / stdoutTail / stderrTail / command / env / tokens)
 * are dropped during projection, even if a future bad writer leaks them.
 */
export function parseIndexLine(line: string): BridgeRunRow | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  if (typeof o.runId !== "string" || !RUN_ID_PATTERN.test(o.runId)) return null;
  if (typeof o.caller !== "string") return null;
  if (typeof o.status !== "string") return null;
  if (typeof o.startedAt !== "string") return null;

  const summary = sanitizeSummary(o.summary);
  if (!summary) return null;

  const row: BridgeRunRow = {
    runId: o.runId,
    caller: String(o.caller),
    target: typeof o.target === "string" ? o.target : "",
    mode: typeof o.mode === "string" ? o.mode : "",
    status: String(o.status),
    startedAt: String(o.startedAt),
    finishedAt: typeof o.finishedAt === "string" ? o.finishedAt : "",
    durationMs: typeof o.durationMs === "number" && Number.isFinite(o.durationMs) ? o.durationMs : 0,
    summary,
    reportDir: typeof o.reportDir === "string" ? o.reportDir : "",
  };
  if (typeof o.suite === "string") row.suite = o.suite;
  if (typeof o.testId === "string") row.testId = o.testId;
  if (typeof o.reportPath === "string") row.reportPath = o.reportPath;
  if (typeof o.latestReportPath === "string") row.latestReportPath = o.latestReportPath;
  return row;
}

function sanitizeSummary(raw: unknown): BridgeRunRowSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v | 0 : 0);
  return {
    totalTests: num(s.totalTests),
    passed: num(s.passed),
    failed: num(s.failed),
    findings: num(s.findings),
    critical: num(s.critical),
    high: num(s.high),
  };
}

/**
 * Resolve an ISO timestamp (or `1d` / `12h` / `30m` / `45s`) into an absolute
 * ISO threshold. Invalid values resolve to `null` (no filtering).
 */
export function parseSince(value: string | undefined, now: Date = new Date()): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;

  const m = v.match(SINCE_RELATIVE_RE);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = n * (unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : 1000);
    return new Date(now.getTime() - ms).toISOString();
  }
  // Try absolute ISO
  const t = Date.parse(v);
  if (Number.isFinite(t)) return new Date(t).toISOString();
  return null;
}

export function clampLimit(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  if (n > MAX_LIMIT) return MAX_LIMIT;
  return Math.floor(n);
}

/**
 * Apply filters + sort newest-first + limit. Pure: no I/O.
 */
export function applyFilters(rows: BridgeRunRow[], filters: BridgeRunListFilters, now: Date = new Date()): BridgeRunRow[] {
  const limit = clampLimit(filters.limit);
  const sinceIso = parseSince(filters.since, now);

  let out = rows;
  if (filters.caller) {
    const want = filters.caller;
    out = out.filter((r) => r.caller === want);
  }
  if (filters.status) {
    const want = filters.status;
    out = out.filter((r) => r.status === want);
  }
  if (filters.mode) {
    const want = filters.mode;
    out = out.filter((r) => r.mode === want);
  }
  if (filters.suite) {
    const want = filters.suite;
    out = out.filter((r) => r.suite === want);
  }
  if (sinceIso) {
    out = out.filter((r) => r.startedAt >= sinceIso);
  }

  // Newest first
  out = [...out].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  return out.slice(0, limit);
}

// ── INDEX I/O ──────────────────────────────────────────────────────────────

export async function readBridgeIndex(verumRoot: string): Promise<{ rows: BridgeRunRow[]; malformedCount: number; empty: boolean }> {
  const filePath = path.join(verumRoot, BRIDGE_INDEX_FILE);
  if (!(await fs.pathExists(filePath))) {
    return { rows: [], malformedCount: 0, empty: true };
  }
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return { rows: [], malformedCount: 0, empty: true };
  }
  const rows: BridgeRunRow[] = [];
  let malformedCount = 0;
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    const row = parseIndexLine(line);
    if (row) rows.push(row);
    else malformedCount++;
  }
  return { rows, malformedCount, empty: false };
}

export async function listBridgeRuns(
  verumRoot: string,
  filters: BridgeRunListFilters,
  now: Date = new Date(),
): Promise<BridgeRunListResult> {
  const { rows, malformedCount, empty } = await readBridgeIndex(verumRoot);
  const filtered = applyFilters(rows, filters, now);
  return { rows: filtered, malformedCount, totalRows: rows.length, empty };
}

// ── Detail reader ──────────────────────────────────────────────────────────

/**
 * Resolve the absolute path of an archive directory for a given runId,
 * defending against path traversal. Returns null if the resolved path escapes
 * the bridge root.
 */
function resolveArchiveDir(verumRoot: string, reportDirRelative: string): string | null {
  const bridgeRoot = path.resolve(verumRoot, "reports", "bridge");
  const candidate = path.resolve(verumRoot, reportDirRelative);
  const rel = path.relative(bridgeRoot, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return candidate;
}

/**
 * Sanitize a parsed BRIDGE_RESULT.json into the operator-safe projection.
 * Drops `command`, ignores any unknown keys, never returns reason text.
 */
export function sanitizeBridgeResult(raw: unknown): SanitizedBridgeResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const req = o.request as Record<string, unknown> | undefined;
  if (!req || typeof req !== "object") return null;
  if (typeof o.runId !== "string" || !RUN_ID_PATTERN.test(o.runId)) return null;
  const summary = sanitizeSummary(o.summary);
  if (!summary) return null;
  const archive = o.archive as Record<string, unknown> | undefined;
  const out: SanitizedBridgeResult = {
    runId: o.runId,
    request: {
      caller: typeof req.caller === "string" ? req.caller : "",
      target: typeof req.target === "string" ? req.target : "",
      mode: typeof req.mode === "string" ? req.mode : "",
      reasonLength: typeof req.reasonLength === "number" && Number.isFinite(req.reasonLength) ? req.reasonLength | 0 : 0,
    },
    startedAt: typeof o.startedAt === "string" ? o.startedAt : "",
    finishedAt: typeof o.finishedAt === "string" ? o.finishedAt : "",
    durationMs: typeof o.durationMs === "number" && Number.isFinite(o.durationMs) ? o.durationMs : 0,
    status: typeof o.status === "string" ? o.status : "",
    summary,
    exitCode: typeof o.exitCode === "number" ? o.exitCode : null,
    signal: typeof o.signal === "string" ? o.signal : null,
    timedOut: o.timedOut === true,
    archive: {
      files: Array.isArray(archive?.files) ? archive.files.filter((s) => typeof s === "string") as string[] : [],
      missingFiles: Array.isArray(archive?.missingFiles) ? archive.missingFiles.filter((s) => typeof s === "string") as string[] : [],
    },
  };
  if (typeof req.suite === "string") out.request.suite = req.suite;
  if (typeof req.testId === "string") out.request.testId = req.testId;
  if (typeof req.dryRun === "boolean") out.request.dryRun = req.dryRun;
  if (typeof o.error === "string") out.error = o.error.length > 200 ? o.error.slice(0, 199) + "…" : o.error;
  return out;
}

/**
 * Sanitize a parsed ASSESSMENT.json into a compact summary view.
 * Never returns the raw findings array body — only its length.
 */
export function sanitizeAssessmentSummary(raw: unknown): SanitizedAssessmentSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out: SanitizedAssessmentSummary = {
    findingsCount: Array.isArray(o.findings) ? o.findings.length : 0,
  };
  if (o.summary && typeof o.summary === "object") {
    const s = o.summary as Record<string, unknown>;
    out.summary = {
      total: typeof s.total === "number" ? s.total : undefined,
      pass: typeof s.pass === "number" ? s.pass : undefined,
      fail: typeof s.fail === "number" ? s.fail : undefined,
      warn: typeof s.warn === "number" ? s.warn : undefined,
    };
  }
  if (typeof o.verdict === "string") out.verdict = o.verdict;
  if (o.riskSummary && typeof o.riskSummary === "object") {
    const r = o.riskSummary as Record<string, unknown>;
    out.riskSummary = {
      overallVerdict: typeof r.overallVerdict === "string" ? r.overallVerdict : undefined,
      highestSeverityObserved: typeof r.highestSeverityObserved === "string" ? r.highestSeverityObserved : undefined,
      exploitableFindingsCount: typeof r.exploitableFindingsCount === "number" ? r.exploitableFindingsCount : undefined,
      publicExposureFindingsCount: typeof r.publicExposureFindingsCount === "number" ? r.publicExposureFindingsCount : undefined,
      childSafetyFailuresCount: typeof r.childSafetyFailuresCount === "number" ? r.childSafetyFailuresCount : undefined,
    };
  }
  if (o.operatorSummary && typeof o.operatorSummary === "object") {
    const os = o.operatorSummary as Record<string, unknown>;
    out.operatorSummary = {
      overallVerdict: typeof os.overallVerdict === "string" ? os.overallVerdict : undefined,
      highestSeverity: typeof os.highestSeverity === "string" ? os.highestSeverity : undefined,
      criticalFindingsCount: typeof os.criticalFindingsCount === "number" ? os.criticalFindingsCount : undefined,
      newRegressionsCount: typeof os.newRegressionsCount === "number" ? os.newRegressionsCount : undefined,
      publicExposureCount: typeof os.publicExposureCount === "number" ? os.publicExposureCount : undefined,
      childSafetyFailuresCount: typeof os.childSafetyFailuresCount === "number" ? os.childSafetyFailuresCount : undefined,
    };
  }
  return out;
}

export async function readBridgeRunDetail(verumRoot: string, runId: string): Promise<BridgeRunDetail | null> {
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) return null;

  // Look up the row from INDEX so we trust its reportDir over any caller input.
  const { rows } = await readBridgeIndex(verumRoot);
  const row = rows.find((r) => r.runId === runId) ?? null;
  // If runId not in index, we can still try the date-dir scan as a fallback —
  // but only by re-deriving the path from the runId's date prefix and the runId.
  // To keep this simple and audit-friendly we require the runId to be in INDEX.
  if (!row) return null;

  const archiveDir = resolveArchiveDir(verumRoot, row.reportDir);
  const files = {
    bridgeResult: false,
    assessment: false,
    summaryMd: false,
    summaryJson: false,
    executiveSummaryMd: false,
  };
  let bridgeResult: SanitizedBridgeResult | null = null;
  let assessmentSummary: SanitizedAssessmentSummary | null = null;

  if (archiveDir) {
    files.bridgeResult = await fs.pathExists(path.join(archiveDir, "BRIDGE_RESULT.json"));
    files.assessment = await fs.pathExists(path.join(archiveDir, "ASSESSMENT.json"));
    files.summaryMd = await fs.pathExists(path.join(archiveDir, "SUMMARY.md"));
    files.summaryJson = await fs.pathExists(path.join(archiveDir, "SUMMARY.json"));
    files.executiveSummaryMd = await fs.pathExists(path.join(archiveDir, "EXECUTIVE_SUMMARY.md"));

    if (files.bridgeResult) {
      try {
        const raw = await fs.readJson(path.join(archiveDir, "BRIDGE_RESULT.json"));
        bridgeResult = sanitizeBridgeResult(raw);
      } catch {
        bridgeResult = null;
      }
    }
    if (files.assessment) {
      try {
        const raw = await fs.readJson(path.join(archiveDir, "ASSESSMENT.json"));
        assessmentSummary = sanitizeAssessmentSummary(raw);
      } catch {
        assessmentSummary = null;
      }
    }
  }

  return { row, files, bridgeResult, assessmentSummary };
}
