#!/usr/bin/env node
// verum-trace — read-only cross-correlation tool for one Verum Bridge runId.
//
// Joins three independently-written audit trails:
//   1. Verum:    reports/bridge/INDEX.jsonl  +  reports/bridge/<date>/<runId>/
//   2. Squidley: <state>/verum/followups-<DATE>.jsonl  (verum_followup breadcrumbs)
//   3. Ptah:     <data>/verum/reflex-<DATE>.jsonl       (verum_reflex breadcrumbs)
//
// Hard rules (also asserted by tests):
//   - Read-only. Never executes a bridge run, never writes any file.
//   - Never exposes stdoutTail / stderrTail / command / raw reason text /
//     auth tokens / env vars / raw user prompts / raw shell command text.
//   - Validates runId before any I/O.
//
// CLI:   node tools/verum-trace.mjs <runId> [--json]
//                                          [--verum-root <path>]
//                                          [--squidley-root <path>]
//                                          [--ptah-root <path>]
//                                          [--since 7d]
//                                          [--limit 20]

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ─── Validation ────────────────────────────────────────────────────────────

const RUN_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const RELATIVE_SINCE_RE = /^(\d{1,5})\s*([smhd])$/i;

export function validateRunId(runId) {
  if (typeof runId !== "string") return { ok: false, error: "runId must be a string" };
  if (path.isAbsolute(runId)) return { ok: false, error: "runId must not be an absolute path" };
  if (runId.includes("..") || runId.includes("/") || runId.includes("\\")) {
    return { ok: false, error: "runId contains forbidden path characters" };
  }
  if (!RUN_ID_RE.test(runId)) {
    return { ok: false, error: "runId must match /^[A-Za-z0-9_-]{8,128}$/" };
  }
  return { ok: true };
}

export function parseSince(value, now = new Date()) {
  if (!value) return null;
  const v = String(value).trim();
  if (!v) return null;
  const m = v.match(RELATIVE_SINCE_RE);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = n * (unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : 1000);
    return new Date(now.getTime() - ms).toISOString();
  }
  const t = Date.parse(v);
  if (Number.isFinite(t)) return new Date(t).toISOString();
  return null;
}

export function clampLimit(raw, def = 20, max = 200) {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.max(1, Math.floor(n)), max);
}

// ─── Safe field projections ───────────────────────────────────────────────
//
// Each `project*` function takes a parsed JSON object and returns a fresh
// object with ONLY the whitelisted fields. Anything else is dropped — even
// fields a future writer might add. This is the defense-in-depth layer that
// keeps stdoutTail / command / etc. out of trace output.

function projectSummary(s) {
  if (!s || typeof s !== "object") return undefined;
  return {
    totalTests: Number.isFinite(s.totalTests) ? s.totalTests | 0 : 0,
    passed: Number.isFinite(s.passed) ? s.passed | 0 : 0,
    failed: Number.isFinite(s.failed) ? s.failed | 0 : 0,
    findings: Number.isFinite(s.findings) ? s.findings | 0 : 0,
    critical: Number.isFinite(s.critical) ? s.critical | 0 : 0,
    high: Number.isFinite(s.high) ? s.high | 0 : 0,
  };
}

function safeStr(v) { return typeof v === "string" ? v : undefined; }
function safeNum(v) { return typeof v === "number" && Number.isFinite(v) ? v : undefined; }
function truncate(s, max = 200) {
  if (typeof s !== "string") return undefined;
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export function projectVerumIndexRow(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!safeStr(raw.runId) || !RUN_ID_RE.test(raw.runId)) return null;
  return {
    runId: raw.runId,
    caller: safeStr(raw.caller) ?? "",
    target: safeStr(raw.target) ?? "",
    mode: safeStr(raw.mode) ?? "",
    suite: safeStr(raw.suite),
    testId: safeStr(raw.testId),
    status: safeStr(raw.status) ?? "",
    startedAt: safeStr(raw.startedAt) ?? "",
    finishedAt: safeStr(raw.finishedAt) ?? "",
    durationMs: safeNum(raw.durationMs) ?? 0,
    summary: projectSummary(raw.summary),
    reportDir: safeStr(raw.reportDir),
    reportPath: safeStr(raw.reportPath),
    latestReportPath: safeStr(raw.latestReportPath),
  };
}

export function projectBridgeResult(raw) {
  if (!raw || typeof raw !== "object") return null;
  const req = raw.request && typeof raw.request === "object" ? raw.request : {};
  return {
    runId: safeStr(raw.runId) ?? "",
    request: {
      caller: safeStr(req.caller) ?? "",
      target: safeStr(req.target) ?? "",
      mode: safeStr(req.mode) ?? "",
      suite: safeStr(req.suite),
      testId: safeStr(req.testId),
      reasonLength: safeNum(req.reasonLength) ?? 0,
      dryRun: req.dryRun === true ? true : req.dryRun === false ? false : undefined,
    },
    startedAt: safeStr(raw.startedAt) ?? "",
    finishedAt: safeStr(raw.finishedAt) ?? "",
    durationMs: safeNum(raw.durationMs) ?? 0,
    status: safeStr(raw.status) ?? "",
    summary: projectSummary(raw.summary),
    exitCode: typeof raw.exitCode === "number" ? raw.exitCode : null,
    signal: safeStr(raw.signal) ?? null,
    timedOut: raw.timedOut === true,
    archive: {
      files: Array.isArray(raw.archive?.files) ? raw.archive.files.filter(s => typeof s === "string") : [],
      missingFiles: Array.isArray(raw.archive?.missingFiles) ? raw.archive.missingFiles.filter(s => typeof s === "string") : [],
    },
    error: truncate(safeStr(raw.error)),
  };
}

export function projectAssessmentSummary(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {
    findingsCount: Array.isArray(raw.findings) ? raw.findings.length : 0,
  };
  if (raw.summary && typeof raw.summary === "object") {
    out.summary = {
      total: safeNum(raw.summary.total),
      pass: safeNum(raw.summary.pass),
      fail: safeNum(raw.summary.fail),
      warn: safeNum(raw.summary.warn),
    };
  }
  if (typeof raw.verdict === "string") out.verdict = raw.verdict;
  if (raw.operatorSummary && typeof raw.operatorSummary === "object") {
    out.operatorSummary = {
      overallVerdict: safeStr(raw.operatorSummary.overallVerdict),
      highestSeverity: safeStr(raw.operatorSummary.highestSeverity),
      criticalFindingsCount: safeNum(raw.operatorSummary.criticalFindingsCount),
    };
  }
  return out;
}

export function projectSquidleyBreadcrumb(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.type !== "verum_followup" && raw.source !== "squidley") {
    // Unknown row shape — drop entirely
    return null;
  }
  return {
    type: "verum_followup",
    source: "squidley",
    status: safeStr(raw.status) ?? "",
    suite: safeStr(raw.suite),
    target: safeStr(raw.target),
    receiptId: typeof raw.receiptId === "string" ? raw.receiptId : null,
    patternSignature: typeof raw.patternSignature === "string" ? raw.patternSignature : null,
    flags: Array.isArray(raw.flags) ? raw.flags.filter(s => typeof s === "string") : undefined,
    runId: safeStr(raw.runId),
    reportDir: safeStr(raw.reportDir),
    reportPath: safeStr(raw.reportPath),
    latestReportPath: safeStr(raw.latestReportPath),
    summary: projectSummary(raw.summary),
    startedAt: safeStr(raw.startedAt),
    finishedAt: safeStr(raw.finishedAt),
    durationMs: safeNum(raw.durationMs),
    requestTimeoutMs: safeNum(raw.requestTimeoutMs),
    error: truncate(safeStr(raw.error)),
  };
}

export function projectPtahBreadcrumb(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.type !== "verum_reflex" && raw.source !== "ptah") return null;
  return {
    type: "verum_reflex",
    source: "ptah",
    status: safeStr(raw.status) ?? "",
    mode: safeStr(raw.mode),
    suite: safeStr(raw.suite),
    target: safeStr(raw.target),
    eventId: typeof raw.eventId === "string" ? raw.eventId : null,
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : null,
    trigger: safeStr(raw.trigger),
    signature: typeof raw.signature === "string" ? raw.signature : null,
    runId: safeStr(raw.runId),
    reportDir: safeStr(raw.reportDir),
    reportPath: safeStr(raw.reportPath),
    latestReportPath: safeStr(raw.latestReportPath),
    summary: projectSummary(raw.summary),
    startedAt: safeStr(raw.startedAt),
    finishedAt: safeStr(raw.finishedAt),
    durationMs: safeNum(raw.durationMs),
    requestTimeoutMs: safeNum(raw.requestTimeoutMs),
    error: truncate(safeStr(raw.error)),
  };
}

// ─── JSONL helpers ─────────────────────────────────────────────────────────

async function readLinesIfPresent(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    return content.split("\n").filter(line => line.trim().length > 0);
  } catch {
    return [];
  }
}

async function readJsonlSafely(filePath) {
  const lines = await readLinesIfPresent(filePath);
  const parsed = [];
  let malformed = 0;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      parsed.push(obj);
    } catch {
      malformed++;
    }
  }
  return { parsed, malformed };
}

async function listDatedFiles(dir, prefix) {
  try {
    const entries = await readdir(dir);
    return entries
      .filter(e => e.startsWith(prefix) && e.endsWith(".jsonl"))
      .sort()
      .map(e => path.join(dir, e));
  } catch {
    return [];
  }
}

// ─── Source readers ───────────────────────────────────────────────────────

export async function findVerumIndexRow(verumRoot, runId) {
  const indexPath = path.join(verumRoot, "reports", "bridge", "INDEX.jsonl");
  if (!existsSync(indexPath)) return { row: null, malformed: 0, indexExists: false };
  const { parsed, malformed } = await readJsonlSafely(indexPath);
  for (const obj of parsed) {
    if (obj && obj.runId === runId) {
      const row = projectVerumIndexRow(obj);
      if (row) return { row, malformed, indexExists: true };
    }
  }
  return { row: null, malformed, indexExists: true };
}

export async function checkArchiveFiles(verumRoot, indexRow) {
  if (!indexRow || !indexRow.reportDir) {
    return { reportDirExists: false, bridgeResultExists: false, assessmentExists: false, bridgeResult: null, assessmentSummary: null };
  }
  // reportDir is stored relative in the INDEX. Resolve under verumRoot.
  const absReportDir = path.resolve(verumRoot, indexRow.reportDir);
  // Defense: re-check that the resolved path is inside reports/bridge.
  const bridgeRoot = path.resolve(verumRoot, "reports", "bridge");
  if (path.relative(bridgeRoot, absReportDir).startsWith("..")) {
    return { reportDirExists: false, bridgeResultExists: false, assessmentExists: false, bridgeResult: null, assessmentSummary: null };
  }
  const reportDirExists = existsSync(absReportDir);
  const bridgeResultPath = path.join(absReportDir, "BRIDGE_RESULT.json");
  const assessmentPath = path.join(absReportDir, "ASSESSMENT.json");
  const bridgeResultExists = existsSync(bridgeResultPath);
  const assessmentExists = existsSync(assessmentPath);

  let bridgeResult = null;
  if (bridgeResultExists) {
    try {
      bridgeResult = projectBridgeResult(JSON.parse(await readFile(bridgeResultPath, "utf8")));
    } catch { /* skip */ }
  }
  let assessmentSummary = null;
  if (assessmentExists) {
    try {
      assessmentSummary = projectAssessmentSummary(JSON.parse(await readFile(assessmentPath, "utf8")));
    } catch { /* skip */ }
  }
  return { reportDirExists, bridgeResultExists, assessmentExists, bridgeResult, assessmentSummary };
}

async function findBreadcrumbsByRunId(dir, prefix, runId, projectFn, sinceIso, limit) {
  const files = await listDatedFiles(dir, prefix);
  const matches = [];
  let malformed = 0;
  for (const file of files) {
    const { parsed, malformed: m } = await readJsonlSafely(file);
    malformed += m;
    for (const raw of parsed) {
      if (!raw || raw.runId !== runId) continue;
      if (sinceIso && typeof raw.startedAt === "string" && raw.startedAt < sinceIso) continue;
      const projected = projectFn(raw);
      if (projected) matches.push(projected);
    }
  }
  // Sort newest-first by startedAt
  matches.sort((a, b) => {
    const sa = a.startedAt ?? "";
    const sb = b.startedAt ?? "";
    return sa < sb ? 1 : sa > sb ? -1 : 0;
  });
  return { matches: matches.slice(0, limit), malformed, scannedFiles: files.length };
}

export async function findSquidleyBreadcrumbs(squidleyRoot, runId, opts = {}) {
  const dir = path.join(
    process.env.SQUIDLEY_STATE_DIR ?? path.join(squidleyRoot, "state"),
    "verum",
  );
  return findBreadcrumbsByRunId(
    dir, "followups-", runId, projectSquidleyBreadcrumb,
    opts.sinceIso ?? null, opts.limit ?? 20,
  );
}

export async function findPtahBreadcrumbs(ptahRoot, runId, opts = {}) {
  const dir = path.join(
    process.env.PTAH_DATA_DIR ?? path.join(ptahRoot, "data"),
    "verum",
  );
  return findBreadcrumbsByRunId(
    dir, "reflex-", runId, projectPtahBreadcrumb,
    opts.sinceIso ?? null, opts.limit ?? 20,
  );
}

// ─── Orchestrator ─────────────────────────────────────────────────────────

export async function traceRun({ runId, verumRoot, squidleyRoot, ptahRoot, since, limit, now }) {
  const v = validateRunId(runId);
  if (!v.ok) {
    return { ok: false, error: v.error, runId: typeof runId === "string" ? runId.slice(0, 32) : "" };
  }

  const sinceIso = parseSince(since, now ?? new Date());
  const lim = clampLimit(limit);

  const { row, malformed: indexMalformed, indexExists } = await findVerumIndexRow(verumRoot, runId);
  const archive = await checkArchiveFiles(verumRoot, row);
  const sq = await findSquidleyBreadcrumbs(squidleyRoot, runId, { sinceIso, limit: lim });
  const pt = await findPtahBreadcrumbs(ptahRoot, runId, { sinceIso, limit: lim });

  return {
    ok: true,
    runId,
    verum: {
      indexExists,
      row,
      ...archive,
      // exposed as their own keys at the top level to make the JSON shape obvious
    },
    squidley: { count: sq.matches.length, matches: sq.matches, scannedFiles: sq.scannedFiles, malformed: sq.malformed },
    ptah: { count: pt.matches.length, matches: pt.matches, scannedFiles: pt.scannedFiles, malformed: pt.malformed },
    files: {
      reportDirExists: archive.reportDirExists,
      bridgeResultExists: archive.bridgeResultExists,
      assessmentExists: archive.assessmentExists,
    },
    diagnostics: {
      indexMalformedLines: indexMalformed,
    },
  };
}

// ─── Human-readable formatter ─────────────────────────────────────────────

export function formatHuman(trace) {
  const lines = [];
  if (!trace.ok) {
    lines.push(`Verum Trace: invalid runId`);
    lines.push(`  error: ${trace.error}`);
    return lines.join("\n");
  }
  lines.push(`Verum Trace: ${trace.runId}`);
  lines.push("");
  lines.push("Verum:");
  if (!trace.verum.indexExists) {
    lines.push("  (reports/bridge/INDEX.jsonl missing — Verum bridge has not run yet)");
  } else if (!trace.verum.row) {
    lines.push("  (no INDEX.jsonl row matches this runId)");
  } else {
    const r = trace.verum.row;
    lines.push(`  status:     ${r.status}`);
    lines.push(`  caller:     ${r.caller}`);
    lines.push(`  mode:       ${r.mode}${r.suite ? ` / ${r.suite}` : r.testId ? ` / ${r.testId}` : ""}`);
    lines.push(`  duration:   ${r.durationMs} ms`);
    lines.push(`  startedAt:  ${r.startedAt}`);
    lines.push(`  finishedAt: ${r.finishedAt}`);
    if (r.reportDir)        lines.push(`  reportDir:  ${r.reportDir}`);
    if (r.reportPath)       lines.push(`  reportPath: ${r.reportPath}`);
    if (r.latestReportPath) lines.push(`  latestReportPath: ${r.latestReportPath}`);
    lines.push(
      `  files:      reportDir=${trace.verum.reportDirExists ? "yes" : "no"}` +
      ` BRIDGE_RESULT.json=${trace.verum.bridgeResultExists ? "yes" : "no"}` +
      ` ASSESSMENT.json=${trace.verum.assessmentExists ? "yes" : "no"}`,
    );
  }
  lines.push("");
  lines.push("Ptah:");
  if (trace.ptah.count === 0) {
    lines.push("  breadcrumbs: 0");
  } else {
    lines.push(`  breadcrumbs: ${trace.ptah.count}`);
    const latest = trace.ptah.matches[0];
    lines.push(`  latest:      status=${latest.status}` +
      (latest.trigger    ? ` trigger=${latest.trigger}`       : "") +
      (latest.signature  ? ` signature=${latest.signature}`   : "") +
      (latest.eventId    ? ` eventId=${latest.eventId}`       : "") +
      (latest.sessionId  ? ` sessionId=${latest.sessionId}`   : ""));
  }
  lines.push("");
  lines.push("Squidley:");
  if (trace.squidley.count === 0) {
    lines.push("  breadcrumbs: 0");
  } else {
    lines.push(`  breadcrumbs: ${trace.squidley.count}`);
    const latest = trace.squidley.matches[0];
    lines.push(`  latest:      status=${latest.status}` +
      (latest.receiptId        ? ` receiptId=${latest.receiptId}`             : "") +
      (latest.patternSignature ? ` pattern=${latest.patternSignature}`        : ""));
  }

  // Summary roll-up — prefer Verum row summary, fall back to bridge result.
  const summary = trace.verum.row?.summary ?? trace.verum.bridgeResult?.summary;
  if (summary) {
    lines.push("");
    lines.push("Summary:");
    lines.push(
      `  tests=${summary.totalTests} passed=${summary.passed} failed=${summary.failed}` +
      ` findings=${summary.findings} critical=${summary.critical} high=${summary.high}`,
    );
  }

  lines.push("");
  lines.push(`Dashboard: http://localhost:3030/bridge/runs   (then click ${trace.runId.slice(0, 24)}…)`);

  return lines.join("\n");
}

// ─── CLI ───────────────────────────────────────────────────────────────────

function parseArgv(argv) {
  const out = {
    runId: undefined,
    json: false,
    verumRoot: undefined,
    squidleyRoot: undefined,
    ptahRoot: undefined,
    since: undefined,
    limit: undefined,
    help: false,
    error: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { out.help = true; continue; }
    if (a === "--json")               { out.json = true; continue; }
    if (a === "--")                   { continue; }
    if (a === "--verum-root"    || a === "--squidley-root" || a === "--ptah-root" ||
        a === "--since"         || a === "--limit") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        out.error = `${a} requires a value`;
        return out;
      }
      i++;
      if (a === "--verum-root")    out.verumRoot    = value;
      if (a === "--squidley-root") out.squidleyRoot = value;
      if (a === "--ptah-root")     out.ptahRoot     = value;
      if (a === "--since")         out.since        = value;
      if (a === "--limit")         out.limit        = value;
      continue;
    }
    if (a.startsWith("--")) {
      out.error = `Unknown flag: ${a}`;
      return out;
    }
    if (out.runId === undefined) {
      out.runId = a;
    } else {
      out.error = "Unexpected extra positional argument";
      return out;
    }
  }
  return out;
}

const HELP = `verum-trace — read-only cross-correlation for one Verum Bridge runId.

Usage:
  node tools/verum-trace.mjs <runId> [flags]

Flags:
  --json                   Output sanitized JSON only.
  --verum-root <path>      Override Verum repo root (default: cwd / /mnt/ai/Verum).
  --squidley-root <path>   Override Squidley root (default: /mnt/ai/squidley-v2).
  --ptah-root <path>       Override Ptah root (default: /mnt/ai/ptah).
  --since <1d|12h|30m|ISO> Drop breadcrumbs with startedAt before threshold.
  --limit <n>              Max breadcrumb matches per source. Default 20, max 200.
  --help, -h               Show this help.

Exit codes:
  0  trace produced (regardless of whether matches were found)
  2  bad CLI usage (unknown flag, missing value, invalid runId)`;

function defaultRoots() {
  return {
    verumRoot:    process.env.VERUM_ROOT    ?? process.cwd(),
    squidleyRoot: process.env.SQUIDLEY_ROOT ?? "/mnt/ai/squidley-v2",
    ptahRoot:     process.env.PTAH_ROOT     ?? "/mnt/ai/ptah",
  };
}

export async function main(argv) {
  const opts = parseArgv(argv);
  if (opts.help) {
    process.stdout.write(HELP + "\n");
    return 0;
  }
  if (opts.error) {
    process.stderr.write(`  ERROR: ${opts.error}\n`);
    process.stderr.write("  Run with --help for usage.\n");
    return 2;
  }
  if (!opts.runId) {
    process.stderr.write("  ERROR: missing <runId>\n");
    process.stderr.write("  Run with --help for usage.\n");
    return 2;
  }

  const roots = defaultRoots();
  const trace = await traceRun({
    runId: opts.runId,
    verumRoot:    opts.verumRoot    ?? roots.verumRoot,
    squidleyRoot: opts.squidleyRoot ?? roots.squidleyRoot,
    ptahRoot:     opts.ptahRoot     ?? roots.ptahRoot,
    since:        opts.since,
    limit:        opts.limit,
  });

  if (!trace.ok) {
    if (opts.json) {
      process.stdout.write(JSON.stringify(trace, null, 2) + "\n");
    } else {
      process.stdout.write(formatHuman(trace) + "\n");
    }
    return 2;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(trace, null, 2) + "\n");
  } else {
    process.stdout.write(formatHuman(trace) + "\n");
  }
  return 0;
}

// Run when invoked directly (not when imported by tests).
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`[verum-trace] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
