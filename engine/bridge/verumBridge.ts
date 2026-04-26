// Verum Bridge — narrow, allowlisted runner for Ptah / Squidley / Ricky / manual callers.
//
// Stable contract:
//   request:  BridgeRequest    (validated against allowlists)
//   response: BridgeResult     (normalized, no secrets, bounded stdout/stderr tails)
//
// Hard rules enforced here:
//   - Caller may only choose from allowlisted callers/targets/modes/suites
//   - No arbitrary command strings: every dispatched command is a fixed argv array
//   - No shell interpolation: spawn is invoked with shell=false (default)
//   - cwd is locked to the Verum project root
//   - dryRun returns the planned argv without executing
//   - Concurrency: a single in-flight `suite all` is permitted; further `suite all`
//     requests are blocked. Smoke and report runs are always permitted.
//   - Per-mode safe timeout default; caller may override within bounds.

import { spawn, ChildProcess } from "child_process";
import { randomBytes } from "crypto";
import path from "path";
import fs from "fs-extra";

// --- Public types ---

export type BridgeCaller = "ptah" | "squidley" | "ricky" | "manual";
export type BridgeMode = "smoke" | "suite" | "test" | "report";
export type BridgeSuite =
  | "recon"
  | "security"
  | "prompt-injection"
  | "child-safety"
  | "multi-turn"
  | "exfil"
  | "all";

export type BridgeStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "blocked"
  | "error";

export interface BridgeRequest {
  caller: BridgeCaller;
  target?: string;
  mode: BridgeMode;
  suite?: BridgeSuite;
  testId?: string;
  reason?: string;
  maxRuntimeMs?: number;
  dryRun?: boolean;
}

export interface BridgeSummary {
  totalTests: number;
  passed: number;
  failed: number;
  findings: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface BridgeResult {
  ok: boolean;
  status: BridgeStatus;
  caller: string;
  target: string;
  mode: string;
  suite?: string;
  testId?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs: number;
  summary: BridgeSummary;
  /**
   * Stable per-run primary report path. After a successful archive this points
   * at the archived ASSESSMENT.json (or BRIDGE_RESULT.json when no upstream
   * report was produced). On dryRun / blocked validation / archive failure,
   * left undefined.
   */
  reportPath?: string;
  /**
   * Stable per-run archive directory under reports/bridge/<date>/<runId>/.
   * Absent on dryRun and on validation-blocked requests.
   */
  reportDir?: string;
  /**
   * Pointer to reports/latest/ASSESSMENT.json (or SUMMARY.md for `mode=report`)
   * — useful for human review via `npm run web` or `verum report summary`.
   * Always points at the rolling latest snapshot, which subsequent runs will
   * overwrite. Consumers wanting durable evidence should use reportPath.
   */
  latestReportPath?: string;
  /** Stable run identifier; embedded in reportDir. */
  runId?: string;
  receiptPath?: string;
  stdoutTail: string;
  stderrTail: string;
  error?: string;
  // Bridge extension (safe — no secrets): the exact argv that was/would be run.
  command?: string[];
}

// --- Allowlists (single source of truth) ---

export const ALLOWED_CALLERS: ReadonlyArray<BridgeCaller> = [
  "ptah",
  "squidley",
  "ricky",
  "manual",
];

export const ALLOWED_TARGETS: ReadonlyArray<string> = ["mushin-local"];

export const DEFAULT_TARGET = "mushin-local";

export const ALLOWED_MODES: ReadonlyArray<BridgeMode> = [
  "smoke",
  "suite",
  "test",
  "report",
];

export const ALLOWED_SUITES: ReadonlyArray<BridgeSuite> = [
  "recon",
  "security",
  "prompt-injection",
  "child-safety",
  "multi-turn",
  "exfil",
  "all",
];

// "prompt-injection" is a Verum-Bridge alias for the upstream "security" suite.
const SUITE_TO_VERUM: Record<BridgeSuite, string> = {
  recon: "recon",
  security: "security",
  "prompt-injection": "security",
  "child-safety": "child-safety",
  "multi-turn": "multi-turn",
  exfil: "exfil",
  all: "all",
};

export const DEFAULT_TIMEOUTS_MS = {
  smoke: 60_000,
  suiteCategory: 300_000,
  suiteAll: 1_800_000,
  test: 120_000,
  report: 30_000,
} as const;

// Hard upper bound — caller may not exceed this even with override.
export const MAX_RUNTIME_MS = 2 * 60 * 60 * 1000; // 2 hours

const STDOUT_TAIL_BYTES = 4_096;
const STDERR_TAIL_BYTES = 4_096;

// --- Concurrency tracking ---

interface ActiveRun {
  id: string;
  caller: BridgeCaller;
  mode: BridgeMode;
  suite?: BridgeSuite;
  startedAt: string;
}

const activeRuns = new Map<string, ActiveRun>();

export function getActiveRuns(): ActiveRun[] {
  return Array.from(activeRuns.values());
}

function fullSweepActive(): boolean {
  for (const r of activeRuns.values()) {
    if (r.mode === "suite" && r.suite === "all") return true;
  }
  return false;
}

// --- Validation ---

const TEST_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

interface ValidationFailure {
  status: "blocked" | "error";
  error: string;
}

function validateRequest(
  req: BridgeRequest
): { ok: true; normalized: Required<Pick<BridgeRequest, "caller" | "target" | "mode" | "dryRun">> & BridgeRequest } | { ok: false; failure: ValidationFailure } {
  if (!req || typeof req !== "object") {
    return { ok: false, failure: { status: "error", error: "Request body must be an object." } };
  }

  if (!ALLOWED_CALLERS.includes(req.caller)) {
    return {
      ok: false,
      failure: {
        status: "blocked",
        error: `Unknown caller '${req.caller}'. Allowed: ${ALLOWED_CALLERS.join(", ")}.`,
      },
    };
  }

  const target = req.target ?? DEFAULT_TARGET;
  if (!ALLOWED_TARGETS.includes(target)) {
    return {
      ok: false,
      failure: {
        status: "blocked",
        error: `Unknown target '${target}'. Allowed: ${ALLOWED_TARGETS.join(", ")}.`,
      },
    };
  }

  if (!ALLOWED_MODES.includes(req.mode)) {
    return {
      ok: false,
      failure: {
        status: "blocked",
        error: `Unknown mode '${req.mode}'. Allowed: ${ALLOWED_MODES.join(", ")}.`,
      },
    };
  }

  if (req.mode === "suite") {
    if (!req.suite) {
      return { ok: false, failure: { status: "error", error: "mode=suite requires 'suite' field." } };
    }
    if (!ALLOWED_SUITES.includes(req.suite)) {
      return {
        ok: false,
        failure: {
          status: "blocked",
          error: `Unknown suite '${req.suite}'. Allowed: ${ALLOWED_SUITES.join(", ")}.`,
        },
      };
    }
    if (req.suite === "all" && (!req.reason || !req.reason.trim())) {
      return {
        ok: false,
        failure: {
          status: "blocked",
          error: "suite=all requires a non-empty 'reason' field for audit.",
        },
      };
    }
  }

  if (req.mode === "test") {
    if (!req.testId || typeof req.testId !== "string" || !TEST_ID_PATTERN.test(req.testId)) {
      return {
        ok: false,
        failure: {
          status: "blocked",
          error: "mode=test requires a 'testId' matching /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.",
        },
      };
    }
  }

  if (req.maxRuntimeMs !== undefined) {
    if (typeof req.maxRuntimeMs !== "number" || !Number.isFinite(req.maxRuntimeMs) || req.maxRuntimeMs <= 0) {
      return { ok: false, failure: { status: "error", error: "'maxRuntimeMs' must be a positive number." } };
    }
    if (req.maxRuntimeMs > MAX_RUNTIME_MS) {
      return {
        ok: false,
        failure: {
          status: "blocked",
          error: `'maxRuntimeMs' exceeds hard cap of ${MAX_RUNTIME_MS}ms.`,
        },
      };
    }
  }

  return {
    ok: true,
    normalized: {
      ...req,
      caller: req.caller,
      target,
      mode: req.mode,
      dryRun: !!req.dryRun,
    },
  };
}

// --- Command building ---

export interface PlannedCommand {
  argv: string[];
  timeoutMs: number;
}

export function planCommand(req: BridgeRequest, opts?: { verumRoot?: string }): PlannedCommand {
  const root = opts?.verumRoot ?? defaultVerumRoot();
  const cli = path.join(root, "bin", "verum.js");
  const target = req.target ?? DEFAULT_TARGET;

  switch (req.mode) {
    case "smoke":
      return {
        argv: ["node", cli, "run", "baseline-chat", "--target", target],
        timeoutMs: req.maxRuntimeMs ?? DEFAULT_TIMEOUTS_MS.smoke,
      };
    case "suite": {
      const suiteName = SUITE_TO_VERUM[req.suite as BridgeSuite];
      const defaultTimeout =
        req.suite === "all" ? DEFAULT_TIMEOUTS_MS.suiteAll : DEFAULT_TIMEOUTS_MS.suiteCategory;
      return {
        argv: ["node", cli, "suite", suiteName, "--target", target],
        timeoutMs: req.maxRuntimeMs ?? defaultTimeout,
      };
    }
    case "test":
      return {
        argv: ["node", cli, "run", req.testId as string, "--target", target],
        timeoutMs: req.maxRuntimeMs ?? DEFAULT_TIMEOUTS_MS.test,
      };
    case "report":
      return {
        argv: ["node", cli, "report", "summary"],
        timeoutMs: req.maxRuntimeMs ?? DEFAULT_TIMEOUTS_MS.report,
      };
  }
}

export function defaultVerumRoot(): string {
  // Walk up from __dirname looking for the verum package.json. Robust whether the
  // module is loaded from source (engine/bridge) or compiled (dist/engine/bridge).
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const pkgPath = path.join(dir, "package.json");
    try {
      const pkg = require(pkgPath) as { name?: string };
      if (pkg && pkg.name === "verum") return dir;
    } catch {
      // not here, keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: assume cwd is project root (bin/verum.js chdirs to it on startup).
  return process.cwd();
}

// --- Executor (mockable) ---

export interface ExecutorRequest {
  argv: string[];
  cwd: string;
  timeoutMs: number;
}

export interface ExecutorResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export type Executor = (req: ExecutorRequest) => Promise<ExecutorResult>;

export const realExecutor: Executor = (req) => {
  return new Promise((resolve) => {
    const [cmd, ...args] = req.argv;
    const startedAt = Date.now();
    const child: ChildProcess = spawn(cmd, args, {
      cwd: req.cwd,
      // shell=false (default) — no shell interpolation
      shell: false,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, req.timeoutMs);
    timer.unref?.();

    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        signal: null,
        stdout,
        stderr: stderr + `\n[bridge] spawn error: ${err.message}`,
        timedOut: false,
        durationMs: Date.now() - startedAt,
      });
    });
  });
};

// --- Stdout/stderr tail (strip ANSI, last N bytes) ---

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

function tailString(s: string, maxBytes: number): string {
  const stripped = s.replace(ANSI_RE, "");
  if (stripped.length <= maxBytes) return stripped;
  return "…" + stripped.slice(stripped.length - maxBytes);
}

// --- Summary parsing ---

const SUMMARY_LINE_RE =
  /PASS:\s*(\d+)\s+FAIL:\s*(\d+)\s+WARN:\s*(\d+)\s+Total:\s*(\d+)/;
const SINGLE_PASS_RE = /\[PASS\]\s+/;
const SINGLE_FAIL_RE = /\[FAIL\]\s+/;
const SINGLE_WARN_RE = /\[WARN\]\s+/;

function emptySummary(): BridgeSummary {
  return {
    totalTests: 0,
    passed: 0,
    failed: 0,
    findings: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
}

interface AssessmentLite {
  summary?: { total?: number; pass?: number; fail?: number; warn?: number };
  findings?: Array<{ severity?: string }>;
}

async function readAssessment(verumRoot: string): Promise<AssessmentLite | null> {
  const p = path.join(verumRoot, "reports", "latest", "ASSESSMENT.json");
  try {
    if (!(await fs.pathExists(p))) return null;
    return (await fs.readJson(p)) as AssessmentLite;
  } catch {
    return null;
  }
}

function summarizeFromAssessment(assessment: AssessmentLite): BridgeSummary {
  const counts = emptySummary();
  const s = assessment.summary ?? {};
  counts.totalTests = Number(s.total ?? 0);
  counts.passed = Number(s.pass ?? 0);
  counts.failed = Number(s.fail ?? 0);
  for (const f of assessment.findings ?? []) {
    const sev = (f.severity ?? "").toLowerCase();
    if (sev === "critical") counts.critical++;
    else if (sev === "high") counts.high++;
    else if (sev === "medium") counts.medium++;
    else if (sev === "low") counts.low++;
  }
  counts.findings = (assessment.findings ?? []).length;
  return counts;
}

function summarizeFromStdout(stdout: string): BridgeSummary {
  const counts = emptySummary();
  const m = stdout.match(SUMMARY_LINE_RE);
  if (m) {
    counts.passed = Number(m[1]);
    counts.failed = Number(m[2]);
    counts.totalTests = Number(m[4]);
    counts.findings = counts.failed;
    return counts;
  }
  // Single test fallback: count [PASS]/[FAIL]/[WARN] markers
  counts.passed = (stdout.match(new RegExp(SINGLE_PASS_RE, "g")) ?? []).length;
  counts.failed = (stdout.match(new RegExp(SINGLE_FAIL_RE, "g")) ?? []).length;
  const warn = (stdout.match(new RegExp(SINGLE_WARN_RE, "g")) ?? []).length;
  counts.totalTests = counts.passed + counts.failed + warn;
  counts.findings = counts.failed;
  return counts;
}

// --- Stable run ID + archive ---
//
// Bridge runs on Mushin write into the same `reports/latest/` directory that
// the human dashboard and `verum report summary` use. That directory is
// overwritten on every test run, so a `reportPath` returned to a consumer
// (Squidley follow-up, Ptah reflex, Ricky preflight) becomes stale within
// minutes. The bridge therefore archives a curated snapshot of `reports/latest/`
// into a per-run directory under `reports/bridge/<YYYY-MM-DD>/<runId>/` and
// returns that stable path instead.
//
// Sanitization rules for runId components:
//   - Lower-case, [a-z0-9-] only, max 24 chars per component.
//   - The user-supplied `reason` is NOT used in the path under any circumstance.
//   - testId already passes the bridge's TEST_ID_PATTERN, so it is safe but
//     still re-sanitized.
//
// Archive scope: a fixed allowlist of filenames — never copies arbitrary
// `reports/latest/*` content, never follows caller-controlled paths.

export const BRIDGE_ARCHIVE_FILES: ReadonlyArray<string> = [
  "ASSESSMENT.json",
  "SUMMARY.json",
  "SUMMARY.md",
  "EVIDENCE_APPENDIX.json",
  "EVIDENCE_APPENDIX.md",
  "EXECUTIVE_SUMMARY.md",
  "TECHNICAL_FINDINGS.md",
  "TRANSPARENCY.md",
  "EXECUTION.json",
  "AI_SHARE_PACKAGE.md",
];

const RUNID_COMPONENT_MAX = 24;

export function safeRunIdComponent(s: string | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, RUNID_COMPONENT_MAX);
}

function compactIso(date: Date): string {
  // 2026-04-26T03:21:55.123Z -> 20260426T032155Z
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "").replace(/Z$/, "Z");
}

export interface BuildRunIdInput {
  caller: string;
  mode: string;
  suite?: string;
  testId?: string;
  /** Override the timestamp source; tests inject. */
  now?: Date;
  /** Override the random suffix; tests inject. */
  rand?: string;
}

export function buildRunId(input: BuildRunIdInput): string {
  const ts = compactIso(input.now ?? new Date());
  const parts: string[] = [ts, safeRunIdComponent(input.caller) || "unknown", safeRunIdComponent(input.mode) || "unknown"];
  if (input.suite) parts.push(safeRunIdComponent(input.suite));
  else if (input.testId) parts.push(safeRunIdComponent(input.testId));
  const rand = input.rand ?? randomBytes(3).toString("hex");
  parts.push(safeRunIdComponent(rand) || "000000");
  return parts.filter(Boolean).join("-");
}

export interface BridgeRunMetadata {
  runId: string;
  request: {
    caller: string;
    target: string;
    mode: string;
    suite?: string;
    testId?: string;
    /** Reason length only — the actual text is not persisted to evidence. */
    reasonLength: number;
    dryRun?: boolean;
  };
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: BridgeStatus;
  summary: BridgeSummary;
  command: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  archive: {
    files: string[];
    missingFiles: string[];
  };
  error?: string;
}

export interface ArchiveBridgeRunInput {
  verumRoot: string;
  runId: string;
  metadata: BridgeRunMetadata;
  /**
   * Absolute path to reports/latest/ASSESSMENT.json (or SUMMARY.md for report
   * mode) at the moment the bridge run was scored. Persisted into the INDEX
   * entry as a relative path, never into BRIDGE_RESULT.json itself.
   */
  latestReportPath?: string;
  /** Test seam: skip the INDEX.jsonl append. */
  skipIndex?: boolean;
}

export interface ArchiveBridgeRunResult {
  reportDir: string;
  reportPath?: string;
  copiedFiles: string[];
  missingFiles: string[];
  indexAppended?: boolean;
  indexError?: string;
}

// --- INDEX.jsonl ---
//
// `reports/bridge/INDEX.jsonl` is a per-run, append-only ledger that lets
// operators answer "show me bridge runs since X" without walking date dirs.
// Lines are independently parseable JSON. Paths are stored RELATIVE to the
// Verum root so the file is portable across machines.
//
// The index never contains: stdoutTail, stderrTail, command, raw reason text,
// env vars, auth tokens, or raw user input. Only the compact fields below.

export const BRIDGE_INDEX_PATH = "reports/bridge/INDEX.jsonl";

export interface BridgeIndexEntry {
  runId: string;
  caller: string;
  target: string;
  mode: string;
  suite?: string;
  testId?: string;
  status: BridgeStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  summary: BridgeSummary;
  /** Relative to verumRoot, e.g. "reports/bridge/2026-04-26/<runId>". */
  reportDir: string;
  /** Relative to verumRoot. May point at ASSESSMENT.json/SUMMARY.md/BRIDGE_RESULT.json. */
  reportPath?: string;
  /** Relative to verumRoot. Present only when the rolling latest pointer was set. */
  latestReportPath?: string;
}

function toRelative(verumRoot: string, absPath: string | undefined): string | undefined {
  if (!absPath) return undefined;
  const rel = path.relative(verumRoot, absPath);
  // Defensive: if relative path escapes verumRoot, drop it rather than persist
  // a `..` in the index. (Caller paths are derived from verumRoot already, so
  // this should never happen in practice; the guard is belt-and-suspenders.)
  if (rel.startsWith("..")) return undefined;
  return rel;
}

export async function appendBridgeIndex(
  verumRoot: string,
  entry: BridgeIndexEntry,
): Promise<void> {
  const filePath = path.join(verumRoot, BRIDGE_INDEX_PATH);
  await fs.ensureDir(path.dirname(filePath));
  const line = JSON.stringify(entry);
  await fs.appendFile(filePath, line + "\n", "utf8");
}

/**
 * Best-effort: copy a curated allowlist of `reports/latest/` artifacts into a
 * stable per-run directory and write `BRIDGE_RESULT.json` with run metadata.
 *
 * Throws on directory creation failure. Individual file-copy failures are
 * swallowed and counted in `missingFiles`.
 */
export async function archiveBridgeRun(input: ArchiveBridgeRunInput): Promise<ArchiveBridgeRunResult> {
  const { verumRoot, runId, metadata, latestReportPath, skipIndex } = input;
  const today = (metadata.startedAt || new Date().toISOString()).slice(0, 10); // YYYY-MM-DD
  const reportDir = path.join(verumRoot, "reports", "bridge", today, runId);
  const latestDir = path.join(verumRoot, "reports", "latest");

  await fs.ensureDir(reportDir);

  const copiedFiles: string[] = [];
  const missingFiles: string[] = [];
  for (const filename of BRIDGE_ARCHIVE_FILES) {
    const src = path.join(latestDir, filename);
    const dst = path.join(reportDir, filename);
    try {
      if (await fs.pathExists(src)) {
        await fs.copy(src, dst, { overwrite: true });
        copiedFiles.push(filename);
      } else {
        missingFiles.push(filename);
      }
    } catch {
      missingFiles.push(filename);
    }
  }

  // Always write BRIDGE_RESULT.json with the canonical metadata, even if
  // nothing else was copied — that gives consumers a stable evidence anchor.
  const finalMetadata: BridgeRunMetadata = {
    ...metadata,
    archive: { files: copiedFiles, missingFiles },
  };
  await fs.writeJson(path.join(reportDir, "BRIDGE_RESULT.json"), finalMetadata, { spaces: 2 });

  // Pick the primary report pointer: archived ASSESSMENT.json if we have one,
  // else SUMMARY.md (used by `mode: report`), else BRIDGE_RESULT.json.
  let reportPath: string;
  if (copiedFiles.includes("ASSESSMENT.json")) {
    reportPath = path.join(reportDir, "ASSESSMENT.json");
  } else if (copiedFiles.includes("SUMMARY.md")) {
    reportPath = path.join(reportDir, "SUMMARY.md");
  } else {
    reportPath = path.join(reportDir, "BRIDGE_RESULT.json");
  }

  // --- Append to INDEX.jsonl (best-effort) ---
  // The index lives at reports/bridge/INDEX.jsonl with one JSON line per run.
  // Failure is isolated: archive-and-index failures never demote a passed run.
  let indexAppended: boolean | undefined;
  let indexError: string | undefined;
  if (!skipIndex) {
    try {
      const relReportDir = toRelative(verumRoot, reportDir);
      const relReportPath = toRelative(verumRoot, reportPath);
      const relLatestReportPath = toRelative(verumRoot, latestReportPath);
      const entry: BridgeIndexEntry = {
        runId,
        caller: metadata.request.caller,
        target: metadata.request.target,
        mode: metadata.request.mode,
        suite: metadata.request.suite,
        testId: metadata.request.testId,
        status: metadata.status,
        startedAt: metadata.startedAt,
        finishedAt: metadata.finishedAt,
        durationMs: metadata.durationMs,
        summary: metadata.summary,
        reportDir: relReportDir ?? "",
        reportPath: relReportPath,
        latestReportPath: relLatestReportPath,
      };
      await appendBridgeIndex(verumRoot, entry);
      indexAppended = true;
    } catch (err) {
      indexError = err instanceof Error ? err.message : String(err);
      try {
        process.stderr.write(`[bridge] INDEX.jsonl append failed for ${runId}: ${indexError}\n`);
      } catch {
        /* swallow */
      }
    }
  }

  return { reportDir, reportPath, copiedFiles, missingFiles, indexAppended, indexError };
}

// --- Bridge entry point ---

export interface BridgeOptions {
  executor?: Executor;
  verumRoot?: string;
  /** Test seam: skip reading reports/latest/ASSESSMENT.json after the run. */
  skipAssessmentRead?: boolean;
  /** Test seam: skip writing the per-run archive directory. */
  skipArchive?: boolean;
  /**
   * Test seam: deterministic runId. Production path always derives a fresh one.
   */
  runIdOverride?: string;
}

export async function runBridge(
  request: BridgeRequest,
  options: BridgeOptions = {}
): Promise<BridgeResult> {
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();

  const validation = validateRequest(request);
  if (!validation.ok) {
    return {
      ok: false,
      status: validation.failure.status,
      caller: String(request?.caller ?? "unknown"),
      target: String(request?.target ?? DEFAULT_TARGET),
      mode: String(request?.mode ?? ""),
      suite: request?.suite,
      testId: request?.testId,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      summary: emptySummary(),
      stdoutTail: "",
      stderrTail: "",
      error: validation.failure.error,
    };
  }

  const req = validation.normalized;
  const verumRoot = options.verumRoot ?? defaultVerumRoot();
  const planned = planCommand(req, { verumRoot });

  // Concurrency guard
  if (req.mode === "suite" && req.suite === "all" && fullSweepActive()) {
    return {
      ok: false,
      status: "blocked",
      caller: req.caller,
      target: req.target as string,
      mode: req.mode,
      suite: req.suite,
      testId: req.testId,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      summary: emptySummary(),
      stdoutTail: "",
      stderrTail: "",
      error: "Another suite=all run is already in progress.",
      command: planned.argv,
    };
  }

  // Dry run: never execute
  if (req.dryRun) {
    return {
      ok: true,
      status: "queued",
      caller: req.caller,
      target: req.target as string,
      mode: req.mode,
      suite: req.suite,
      testId: req.testId,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      summary: emptySummary(),
      stdoutTail: "",
      stderrTail: "",
      command: planned.argv,
    };
  }

  // Register active run
  const runId = `${Date.now()}-${req.caller}-${req.mode}`;
  activeRuns.set(runId, {
    id: runId,
    caller: req.caller,
    mode: req.mode,
    suite: req.suite,
    startedAt,
  });

  let exec: ExecutorResult;
  try {
    const executor = options.executor ?? realExecutor;
    exec = await executor({
      argv: planned.argv,
      cwd: verumRoot,
      timeoutMs: planned.timeoutMs,
    });
  } finally {
    activeRuns.delete(runId);
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startedAtMs;

  // Status
  let status: BridgeStatus;
  let error: string | undefined;
  if (exec.timedOut) {
    status = "error";
    error = `Run exceeded timeout of ${planned.timeoutMs}ms.`;
  } else if (exec.exitCode === 0) {
    status = "passed";
  } else if (exec.exitCode === null) {
    status = "error";
    error = "Process did not exit cleanly.";
  } else {
    status = "failed";
  }

  // Summary
  // Always derive totals/passed/failed from stdout — that's the most honest
  // signal for *this* run. ASSESSMENT.json on disk is a rolling aggregate of
  // every test in reports/latest/ and would inflate single-test or smoke runs.
  // For suite runs we additionally enrich severity buckets from ASSESSMENT.json,
  // since a fresh suite run repopulates it via refreshAssessmentArtifacts(results).
  const summary = summarizeFromStdout(exec.stdout);
  let latestReportPath: string | undefined;
  if (!options.skipAssessmentRead && req.mode === "suite") {
    const assessment = await readAssessment(verumRoot);
    if (assessment) {
      const fromAssessment = summarizeFromAssessment(assessment);
      summary.critical = fromAssessment.critical;
      summary.high = fromAssessment.high;
      summary.medium = fromAssessment.medium;
      summary.low = fromAssessment.low;
      latestReportPath = path.join(verumRoot, "reports", "latest", "ASSESSMENT.json");
    }
  }
  if (req.mode === "report") {
    const summaryMd = path.join(verumRoot, "reports", "latest", "SUMMARY.md");
    if (await fs.pathExists(summaryMd)) latestReportPath = summaryMd;
  }

  // Promote status: if suite/test ran but produced failures, surface that.
  if (status === "passed" && summary.failed > 0) {
    status = "failed";
  }

  // --- Stable archive (best effort) ---
  //
  // dryRun and validation-blocked paths return before reaching here, so any
  // non-skipped run gets an archive attempt. The runId is fresh per call and
  // never reuses the in-flight concurrency-tracker id.
  let archivedReportPath: string | undefined;
  let reportDir: string | undefined;
  let publicRunId: string | undefined;
  if (!options.skipArchive) {
    publicRunId =
      options.runIdOverride ??
      buildRunId({
        caller: req.caller,
        mode: req.mode,
        suite: req.suite,
        testId: req.testId,
        now: new Date(startedAtMs),
      });
    const archiveMetadata: BridgeRunMetadata = {
      runId: publicRunId,
      request: {
        caller: req.caller,
        target: req.target as string,
        mode: req.mode,
        suite: req.suite,
        testId: req.testId,
        // Reason text is intentionally NOT persisted to evidence. Length only.
        reasonLength: typeof req.reason === "string" ? req.reason.length : 0,
        dryRun: false,
      },
      startedAt,
      finishedAt,
      durationMs,
      status,
      summary,
      command: planned.argv,
      exitCode: exec.exitCode,
      signal: exec.signal,
      timedOut: exec.timedOut,
      archive: { files: [], missingFiles: [] },
      error,
    };
    try {
      const arch = await archiveBridgeRun({
        verumRoot,
        runId: publicRunId,
        metadata: archiveMetadata,
        latestReportPath,
      });
      reportDir = arch.reportDir;
      archivedReportPath = arch.reportPath;
    } catch (archiveErr) {
      // Best-effort: never demote run status because archive failed.
      const msg = archiveErr instanceof Error ? archiveErr.message : String(archiveErr);
      try {
        process.stderr.write(`[bridge] archive failed for run ${publicRunId}: ${msg}\n`);
      } catch {
        /* swallow */
      }
    }
  }

  return {
    ok: status === "passed",
    status,
    caller: req.caller,
    target: req.target as string,
    mode: req.mode,
    suite: req.suite,
    testId: req.testId,
    startedAt,
    finishedAt,
    durationMs,
    summary,
    // reportPath = archived (stable). latestReportPath = rolling. If archive
    // didn't run (skipArchive seam), fall back to the rolling latest pointer.
    reportPath: archivedReportPath ?? latestReportPath,
    reportDir,
    latestReportPath,
    runId: publicRunId,
    stdoutTail: tailString(exec.stdout, STDOUT_TAIL_BYTES),
    stderrTail: tailString(exec.stderr, STDERR_TAIL_BYTES),
    error,
    command: planned.argv,
  };
}

// --- Health/allowlist views (used by CLI + HTTP) ---

export function getAllowlist() {
  return {
    allowedCallers: ALLOWED_CALLERS,
    allowedTargets: ALLOWED_TARGETS,
    allowedModes: ALLOWED_MODES,
    allowedSuites: ALLOWED_SUITES,
    defaultTarget: DEFAULT_TARGET,
    defaultTimeoutsMs: DEFAULT_TIMEOUTS_MS,
    maxRuntimeMs: MAX_RUNTIME_MS,
  };
}

export function getHealth() {
  return {
    ok: true,
    service: "verum-bridge",
    verumPath: defaultVerumRoot(),
    defaultTarget: DEFAULT_TARGET,
    allowedSuites: ALLOWED_SUITES,
    activeRuns: getActiveRuns().length,
  };
}

// Test-only helper to clear state between tests.
export function __resetBridgeForTests(): void {
  activeRuns.clear();
}
