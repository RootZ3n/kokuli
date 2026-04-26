import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  validateRunId,
  parseSince,
  clampLimit,
  projectVerumIndexRow,
  projectBridgeResult,
  projectAssessmentSummary,
  projectSquidleyBreadcrumb,
  projectPtahBreadcrumb,
  findVerumIndexRow,
  findSquidleyBreadcrumbs,
  findPtahBreadcrumbs,
  traceRun,
  formatHuman,
  main,
} from "./verum-trace.mjs";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const RUN_ID = "20260426T120000Z-manual-smoke-aaaaaa";

function indexRow(overrides = {}) {
  return {
    runId: RUN_ID,
    caller: "manual",
    target: "mushin-local",
    mode: "smoke",
    status: "passed",
    startedAt: "2026-04-26T12:00:00.000Z",
    finishedAt: "2026-04-26T12:00:01.000Z",
    durationMs: 1500,
    summary: { totalTests: 1, passed: 1, failed: 0, findings: 0, critical: 0, high: 0 },
    reportDir: `reports/bridge/2026-04-26/${RUN_ID}`,
    reportPath: `reports/bridge/2026-04-26/${RUN_ID}/ASSESSMENT.json`,
    latestReportPath: "reports/latest/ASSESSMENT.json",
    ...overrides,
  };
}

async function withTempVerumRoots(fn) {
  const verumRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vtrace-v-"));
  const squidleyRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vtrace-sq-"));
  const ptahRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vtrace-pt-"));
  try {
    return await fn({ verumRoot, squidleyRoot, ptahRoot });
  } finally {
    await fs.rm(verumRoot, { recursive: true, force: true });
    await fs.rm(squidleyRoot, { recursive: true, force: true });
    await fs.rm(ptahRoot, { recursive: true, force: true });
  }
}

async function writeIndex(verumRoot, lines) {
  const dir = path.join(verumRoot, "reports", "bridge");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "INDEX.jsonl"),
    lines.map(l => typeof l === "string" ? l : JSON.stringify(l)).join("\n") + (lines.length ? "\n" : ""));
}

async function writeArchive(verumRoot, runId, files = {}) {
  const dir = path.join(verumRoot, "reports", "bridge", "2026-04-26", runId);
  await fs.mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), typeof body === "string" ? body : JSON.stringify(body, null, 2));
  }
}

async function writeSquidleyBreadcrumb(squidleyRoot, date, lines) {
  const dir = path.join(squidleyRoot, "state", "verum");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `followups-${date}.jsonl`),
    lines.map(l => typeof l === "string" ? l : JSON.stringify(l)).join("\n") + (lines.length ? "\n" : ""));
}

async function writePtahBreadcrumb(ptahRoot, date, lines) {
  const dir = path.join(ptahRoot, "data", "verum");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `reflex-${date}.jsonl`),
    lines.map(l => typeof l === "string" ? l : JSON.stringify(l)).join("\n") + (lines.length ? "\n" : ""));
}

// ─── validateRunId ─────────────────────────────────────────────────────────

test("validateRunId accepts a real Verum runId", () => {
  assert.equal(validateRunId(RUN_ID).ok, true);
  assert.equal(validateRunId("20260426T120000Z-ricky-suite-security-deadbe").ok, true);
});

test("validateRunId rejects path-traversal / absolute / weird input", () => {
  assert.equal(validateRunId("../etc/passwd").ok, false);
  assert.equal(validateRunId("/absolute/path/x").ok, false);
  assert.equal(validateRunId("a/b").ok, false);
  assert.equal(validateRunId("a\\b").ok, false);
  assert.equal(validateRunId("..").ok, false);
  assert.equal(validateRunId("short").ok, false);
  assert.equal(validateRunId("$(rm -rf /)").ok, false);
  assert.equal(validateRunId("a; rm -rf /").ok, false);
  assert.equal(validateRunId(undefined).ok, false);
  assert.equal(validateRunId(123).ok, false);
});

// ─── parseSince / clampLimit ───────────────────────────────────────────────

test("parseSince handles relative units and ISO", () => {
  const now = new Date("2026-04-26T12:00:00.000Z");
  assert.equal(parseSince("1d", now), "2026-04-25T12:00:00.000Z");
  assert.equal(parseSince("12h", now), "2026-04-26T00:00:00.000Z");
  assert.equal(parseSince("30m", now), "2026-04-26T11:30:00.000Z");
  assert.equal(parseSince("2026-04-25T00:00:00Z", now), "2026-04-25T00:00:00.000Z");
  assert.equal(parseSince("garbage", now), null);
  assert.equal(parseSince(undefined), null);
});

test("clampLimit applies defaults and bounds", () => {
  assert.equal(clampLimit(undefined), 20);
  assert.equal(clampLimit(0), 20);
  assert.equal(clampLimit("abc"), 20);
  assert.equal(clampLimit(50), 50);
  assert.equal(clampLimit(99999), 200);
});

// ─── Projections ───────────────────────────────────────────────────────────

test("projectVerumIndexRow keeps only safe fields", () => {
  const polluted = {
    ...indexRow(),
    reason: "secret-reason-text",
    stdoutTail: "leak",
    stderrTail: "leak",
    command: ["leak"],
    authToken: "Bearer xyz",
  };
  const r = projectVerumIndexRow(polluted);
  const blob = JSON.stringify(r);
  for (const banned of ["secret-reason-text", "stdoutTail", "stderrTail", "authToken", "Bearer", "command"]) {
    assert.equal(blob.includes(banned), false, `leaked: ${banned}`);
  }
});

test("projectVerumIndexRow rejects malformed runId", () => {
  assert.equal(projectVerumIndexRow({ ...indexRow(), runId: "../bad" }), null);
  assert.equal(projectVerumIndexRow({ ...indexRow(), runId: "x" }), null);
  assert.equal(projectVerumIndexRow(null), null);
});

test("projectBridgeResult drops command / stdoutTail and keeps reasonLength", () => {
  const r = projectBridgeResult({
    runId: RUN_ID,
    request: { caller: "manual", target: "mushin-local", mode: "smoke", reasonLength: 12, dryRun: false },
    startedAt: "...", finishedAt: "...", durationMs: 100, status: "passed",
    summary: { totalTests: 1, passed: 1, failed: 0, findings: 0, critical: 0, high: 0 },
    command: ["node", "verum.js", "--secret-flag", "TOKEN"],
    stdoutTail: "should-be-dropped",
    stderrTail: "should-be-dropped",
    exitCode: 0, signal: null, timedOut: false,
    archive: { files: ["ASSESSMENT.json"], missingFiles: [] },
  });
  const blob = JSON.stringify(r);
  for (const banned of ["--secret-flag", "TOKEN", "stdoutTail", "stderrTail", '"command":']) {
    assert.equal(blob.includes(banned), false, `leaked: ${banned}`);
  }
  assert.equal(r.request.reasonLength, 12);
});

test("projectAssessmentSummary returns findingsCount and never the raw findings array", () => {
  const r = projectAssessmentSummary({
    summary: { total: 9, pass: 7, fail: 2, warn: 0 },
    verdict: "low",
    findings: [{ severity: "high" }, { severity: "low" }, { severity: "low" }],
  });
  assert.equal(r.findingsCount, 3);
  assert.equal(JSON.stringify(r).includes("severity"), false);
});

test("projectSquidleyBreadcrumb / projectPtahBreadcrumb whitelist fields", () => {
  const sq = projectSquidleyBreadcrumb({
    type: "verum_followup", source: "squidley",
    status: "passed", suite: "prompt-injection", target: "mushin-local",
    receiptId: "rcpt-1", patternSignature: "reveal_system_prompt",
    flags: ["reveal_system_prompt"],
    runId: RUN_ID, reportDir: "/d", reportPath: "/p", latestReportPath: "/l",
    summary: { totalTests: 1, passed: 1, failed: 0, findings: 0, critical: 0, high: 0 },
    startedAt: "2026-04-26T12:00:00.000Z", durationMs: 100,
    // forbidden:
    stdoutTail: "leak", stderrTail: "leak", command: ["leak"], reason: "secret",
    authToken: "Bearer abc",
  });
  const blob1 = JSON.stringify(sq);
  for (const banned of ["stdoutTail", "stderrTail", '"command":', '"reason":', "authToken", "Bearer", "secret"]) {
    assert.equal(blob1.includes(banned), false, `squidley leaked: ${banned}`);
  }
  assert.equal(sq.runId, RUN_ID);

  const pt = projectPtahBreadcrumb({
    type: "verum_reflex", source: "ptah",
    status: "passed", mode: "smoke", target: "mushin-local",
    eventId: "step-1", sessionId: "task-1",
    trigger: "velum-block", signature: "velum-block:red",
    runId: RUN_ID, reportDir: "/d", reportPath: "/p",
    summary: { totalTests: 1, passed: 1, failed: 0, findings: 0, critical: 0, high: 0 },
    // forbidden:
    stdoutTail: "leak", stderrTail: "leak", command: ["leak"],
    rawShell: "rm -rf /", taskRaw: "rm -rf /", authToken: "Bearer abc",
  });
  const blob2 = JSON.stringify(pt);
  for (const banned of ["stdoutTail", "stderrTail", '"command":', "rawShell", "taskRaw", "rm -rf /", "authToken", "Bearer"]) {
    assert.equal(blob2.includes(banned), false, `ptah leaked: ${banned}`);
  }
});

test("projectSquidleyBreadcrumb rejects unrelated rows", () => {
  assert.equal(projectSquidleyBreadcrumb({ type: "other" }), null);
});

// ─── findVerumIndexRow ─────────────────────────────────────────────────────

test("findVerumIndexRow returns null when INDEX missing", async () => {
  await withTempVerumRoots(async ({ verumRoot }) => {
    const r = await findVerumIndexRow(verumRoot, RUN_ID);
    assert.equal(r.indexExists, false);
    assert.equal(r.row, null);
  });
});

test("findVerumIndexRow finds matching row and skips malformed lines", async () => {
  await withTempVerumRoots(async ({ verumRoot }) => {
    await writeIndex(verumRoot, [
      indexRow({ runId: "20260426T100000Z-other-smoke-bbbbbb" }),
      "this is not json",
      indexRow(),
    ]);
    const r = await findVerumIndexRow(verumRoot, RUN_ID);
    assert.equal(r.indexExists, true);
    assert.equal(r.row.runId, RUN_ID);
    assert.equal(r.malformed, 1);
  });
});

// ─── findSquidleyBreadcrumbs / findPtahBreadcrumbs ─────────────────────────

test("findSquidleyBreadcrumbs matches by runId, sorted newest first", async () => {
  await withTempVerumRoots(async ({ squidleyRoot }) => {
    await writeSquidleyBreadcrumb(squidleyRoot, "2026-04-26", [
      { type: "verum_followup", source: "squidley", runId: RUN_ID, status: "scheduled", startedAt: "2026-04-26T12:00:00.000Z" },
      { type: "verum_followup", source: "squidley", runId: RUN_ID, status: "passed", startedAt: "2026-04-26T12:00:02.000Z" },
      { type: "verum_followup", source: "squidley", runId: "OTHER" },
    ]);
    const r = await findSquidleyBreadcrumbs(squidleyRoot, RUN_ID);
    assert.equal(r.matches.length, 2);
    assert.equal(r.matches[0].status, "passed"); // newest first
  });
});

test("findPtahBreadcrumbs matches similarly and respects limit", async () => {
  await withTempVerumRoots(async ({ ptahRoot }) => {
    await writePtahBreadcrumb(ptahRoot, "2026-04-26", [
      { type: "verum_reflex", source: "ptah", runId: RUN_ID, status: "scheduled", startedAt: "2026-04-26T12:00:00.000Z" },
      { type: "verum_reflex", source: "ptah", runId: RUN_ID, status: "passed", startedAt: "2026-04-26T12:00:02.000Z" },
    ]);
    const r = await findPtahBreadcrumbs(ptahRoot, RUN_ID, { limit: 1 });
    assert.equal(r.matches.length, 1);
    assert.equal(r.matches[0].status, "passed");
  });
});

test("breadcrumb finders apply since filter", async () => {
  await withTempVerumRoots(async ({ ptahRoot }) => {
    await writePtahBreadcrumb(ptahRoot, "2026-04-26", [
      { type: "verum_reflex", source: "ptah", runId: RUN_ID, status: "old", startedAt: "2026-04-25T00:00:00.000Z" },
      { type: "verum_reflex", source: "ptah", runId: RUN_ID, status: "new", startedAt: "2026-04-26T12:00:00.000Z" },
    ]);
    const r = await findPtahBreadcrumbs(ptahRoot, RUN_ID, { sinceIso: "2026-04-26T00:00:00.000Z", limit: 50 });
    assert.equal(r.matches.length, 1);
    assert.equal(r.matches[0].status, "new");
  });
});

// ─── traceRun ──────────────────────────────────────────────────────────────

test("traceRun rejects an unsafe runId before any I/O", async () => {
  const r = await traceRun({ runId: "../etc/passwd", verumRoot: "/", squidleyRoot: "/", ptahRoot: "/" });
  assert.equal(r.ok, false);
  assert.match(r.error, /forbidden path/);
});

test("traceRun finds Verum + Squidley + Ptah for a real runId", async () => {
  await withTempVerumRoots(async ({ verumRoot, squidleyRoot, ptahRoot }) => {
    await writeIndex(verumRoot, [indexRow()]);
    await writeArchive(verumRoot, RUN_ID, {
      "BRIDGE_RESULT.json": {
        runId: RUN_ID,
        request: { caller: "manual", target: "mushin-local", mode: "smoke", reasonLength: 12 },
        startedAt: "2026-04-26T12:00:00.000Z",
        finishedAt: "2026-04-26T12:00:01.000Z",
        durationMs: 1500, status: "passed",
        summary: { totalTests: 1, passed: 1, failed: 0, findings: 0, critical: 0, high: 0 },
        command: ["leak"], stdoutTail: "leak", stderrTail: "leak",
        exitCode: 0, signal: null, timedOut: false,
        archive: { files: ["ASSESSMENT.json"], missingFiles: [] },
      },
      "ASSESSMENT.json": { summary: { total: 1, pass: 1, fail: 0, warn: 0 }, findings: [] },
    });
    await writeSquidleyBreadcrumb(squidleyRoot, "2026-04-26", [
      { type: "verum_followup", source: "squidley", runId: RUN_ID, status: "passed", startedAt: "2026-04-26T12:00:01.000Z", receiptId: "rcpt-1" },
    ]);
    await writePtahBreadcrumb(ptahRoot, "2026-04-26", [
      { type: "verum_reflex", source: "ptah", runId: RUN_ID, status: "passed", startedAt: "2026-04-26T12:00:01.000Z", trigger: "velum-block", eventId: "step-1" },
    ]);
    const trace = await traceRun({ runId: RUN_ID, verumRoot, squidleyRoot, ptahRoot });
    assert.equal(trace.ok, true);
    assert.equal(trace.runId, RUN_ID);
    assert.equal(trace.verum.row.status, "passed");
    assert.equal(trace.verum.bridgeResultExists, true);
    assert.equal(trace.verum.assessmentExists, true);
    assert.equal(trace.squidley.count, 1);
    assert.equal(trace.ptah.count, 1);

    const blob = JSON.stringify(trace);
    for (const banned of ["stdoutTail", "stderrTail", '"command":', "leak"]) {
      assert.equal(blob.includes(banned), false, `leaked: ${banned}`);
    }
  });
});

test("traceRun returns clean 'not found' sections when runId has no matches anywhere", async () => {
  await withTempVerumRoots(async ({ verumRoot, squidleyRoot, ptahRoot }) => {
    await writeIndex(verumRoot, []);
    const trace = await traceRun({ runId: RUN_ID, verumRoot, squidleyRoot, ptahRoot });
    assert.equal(trace.ok, true);
    assert.equal(trace.verum.row, null);
    assert.equal(trace.squidley.count, 0);
    assert.equal(trace.ptah.count, 0);
  });
});

test("traceRun handles missing INDEX.jsonl gracefully", async () => {
  await withTempVerumRoots(async ({ verumRoot, squidleyRoot, ptahRoot }) => {
    const trace = await traceRun({ runId: RUN_ID, verumRoot, squidleyRoot, ptahRoot });
    assert.equal(trace.ok, true);
    assert.equal(trace.verum.indexExists, false);
    assert.equal(trace.verum.row, null);
  });
});

test("traceRun handles archive dir present but ASSESSMENT.json missing", async () => {
  await withTempVerumRoots(async ({ verumRoot, squidleyRoot, ptahRoot }) => {
    await writeIndex(verumRoot, [indexRow()]);
    await writeArchive(verumRoot, RUN_ID, {
      "BRIDGE_RESULT.json": { runId: RUN_ID, request: {}, summary: { totalTests: 0, passed: 0, failed: 0, findings: 0, critical: 0, high: 0 }, archive: {} },
    });
    const trace = await traceRun({ runId: RUN_ID, verumRoot, squidleyRoot, ptahRoot });
    assert.equal(trace.verum.bridgeResultExists, true);
    assert.equal(trace.verum.assessmentExists, false);
    assert.equal(trace.verum.assessmentSummary, null);
  });
});

// ─── formatHuman ───────────────────────────────────────────────────────────

test("formatHuman renders a complete trace including dashboard hint", async () => {
  await withTempVerumRoots(async ({ verumRoot, squidleyRoot, ptahRoot }) => {
    await writeIndex(verumRoot, [indexRow()]);
    await writeArchive(verumRoot, RUN_ID, {});
    const trace = await traceRun({ runId: RUN_ID, verumRoot, squidleyRoot, ptahRoot });
    const text = formatHuman(trace);
    assert.match(text, /Verum Trace: 20260426T120000Z-manual-smoke-aaaaaa/);
    assert.match(text, /status:\s+passed/);
    assert.match(text, /Dashboard: http:\/\/localhost:3030\/bridge\/runs/);
    for (const banned of ["stdoutTail", "stderrTail", "command:"]) {
      assert.equal(text.includes(banned), false);
    }
  });
});

test("formatHuman shows error for invalid runId result", () => {
  const text = formatHuman({ ok: false, error: "runId contains forbidden path characters", runId: "../" });
  assert.match(text, /invalid runId/);
  assert.match(text, /forbidden path/);
});

// ─── --json output ─────────────────────────────────────────────────────────

test("main --json produces valid parseable JSON for a known runId", async () => {
  await withTempVerumRoots(async ({ verumRoot, squidleyRoot, ptahRoot }) => {
    await writeIndex(verumRoot, [indexRow()]);
    // Capture stdout
    const chunks = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { chunks.push(typeof chunk === "string" ? chunk : chunk.toString()); return true; };
    try {
      const code = await main([
        RUN_ID, "--json",
        "--verum-root", verumRoot,
        "--squidley-root", squidleyRoot,
        "--ptah-root", ptahRoot,
      ]);
      assert.equal(code, 0);
    } finally {
      process.stdout.write = origWrite;
    }
    const out = chunks.join("");
    const parsed = JSON.parse(out);
    assert.equal(parsed.runId, RUN_ID);
    assert.equal(parsed.verum.row.status, "passed");
  });
});

test("main exits 2 on bad CLI usage", async () => {
  // Capture stderr
  const origErr = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;
  try {
    assert.equal(await main([]), 2);
    assert.equal(await main(["--unknown-flag"]), 2);
    assert.equal(await main(["--limit"]), 2);
    assert.equal(await main(["../etc/passwd"]), 2);
  } finally {
    process.stderr.write = origErr;
  }
});
