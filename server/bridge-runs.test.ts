import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";
import os from "os";
import path from "path";

import {
  applyFilters,
  BRIDGE_INDEX_FILE,
  clampLimit,
  DEFAULT_LIMIT,
  listBridgeRuns,
  MAX_LIMIT,
  parseIndexLine,
  parseSince,
  readBridgeIndex,
  readBridgeRunDetail,
  sanitizeAssessmentSummary,
  sanitizeBridgeResult,
  type BridgeRunRow,
} from "./bridge-runs";

// ── Fixtures ───────────────────────────────────────────────────────────────

function summary(overrides: Partial<BridgeRunRow["summary"]> = {}): BridgeRunRow["summary"] {
  return {
    totalTests: 1,
    passed: 1,
    failed: 0,
    findings: 0,
    critical: 0,
    high: 0,
    ...overrides,
  };
}

function row(overrides: Partial<BridgeRunRow> = {}): BridgeRunRow {
  return {
    runId: "20260426T120000Z-manual-smoke-aaaaaa",
    caller: "manual",
    target: "mushin-local",
    mode: "smoke",
    status: "passed",
    startedAt: "2026-04-26T12:00:00.000Z",
    finishedAt: "2026-04-26T12:00:01.000Z",
    durationMs: 1000,
    summary: summary(),
    reportDir: "reports/bridge/2026-04-26/20260426T120000Z-manual-smoke-aaaaaa",
    ...overrides,
  };
}

async function withTempVerumRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-runs-"));
  try {
    return await fn(dir);
  } finally {
    await fs.remove(dir);
  }
}

async function writeIndex(root: string, lines: string[]): Promise<void> {
  const p = path.join(root, BRIDGE_INDEX_FILE);
  await fs.ensureDir(path.dirname(p));
  await fs.writeFile(p, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
}

// ── parseIndexLine ─────────────────────────────────────────────────────────

test("parseIndexLine accepts a well-formed row", () => {
  const r = parseIndexLine(JSON.stringify(row()));
  assert.ok(r);
  assert.equal(r!.runId, "20260426T120000Z-manual-smoke-aaaaaa");
  assert.equal(r!.summary.passed, 1);
});

test("parseIndexLine drops forbidden fields even if present", () => {
  const polluted = {
    ...row(),
    reason: "secret reason text",
    stdoutTail: "leak1",
    stderrTail: "leak2",
    command: ["node", "verum.js"],
    authToken: "Bearer xyz",
  };
  const r = parseIndexLine(JSON.stringify(polluted));
  assert.ok(r);
  const blob = JSON.stringify(r);
  for (const banned of ["secret reason text", "stdoutTail", "stderrTail", "authToken", "Bearer xyz", "command"]) {
    assert.equal(blob.includes(banned), false, `leaked: ${banned}`);
  }
});

test("parseIndexLine returns null on invalid runId / missing fields / bad JSON / empty", () => {
  assert.equal(parseIndexLine(""), null);
  assert.equal(parseIndexLine("{not json}"), null);
  assert.equal(parseIndexLine("123"), null);
  assert.equal(parseIndexLine(JSON.stringify({ ...row(), runId: "../etc/passwd" })), null);
  assert.equal(parseIndexLine(JSON.stringify({ ...row(), runId: "x" })), null); // too short
  assert.equal(parseIndexLine(JSON.stringify({ ...row(), runId: undefined })), null);
  assert.equal(parseIndexLine(JSON.stringify({ ...row(), summary: undefined })), null);
});

// ── parseSince ─────────────────────────────────────────────────────────────

test("parseSince accepts relative units", () => {
  const now = new Date("2026-04-26T12:00:00.000Z");
  assert.equal(parseSince("1d", now), "2026-04-25T12:00:00.000Z");
  assert.equal(parseSince("12h", now), "2026-04-26T00:00:00.000Z");
  assert.equal(parseSince("30m", now), "2026-04-26T11:30:00.000Z");
  assert.equal(parseSince("45s", now), "2026-04-26T11:59:15.000Z");
  assert.equal(parseSince("  2H  ", now), "2026-04-26T10:00:00.000Z"); // case + trim
});

test("parseSince accepts ISO timestamps", () => {
  const now = new Date("2026-04-26T12:00:00.000Z");
  assert.equal(parseSince("2026-04-25T00:00:00.000Z", now), "2026-04-25T00:00:00.000Z");
});

test("parseSince returns null on invalid input", () => {
  assert.equal(parseSince(undefined), null);
  assert.equal(parseSince(""), null);
  assert.equal(parseSince("abc"), null);
  assert.equal(parseSince("0d"), null);
  assert.equal(parseSince("-1d"), null);
});

// ── clampLimit ─────────────────────────────────────────────────────────────

test("clampLimit applies defaults and bounds", () => {
  assert.equal(clampLimit(undefined), DEFAULT_LIMIT);
  assert.equal(clampLimit(0), DEFAULT_LIMIT);
  assert.equal(clampLimit(-5), DEFAULT_LIMIT);
  assert.equal(clampLimit("abc"), DEFAULT_LIMIT);
  assert.equal(clampLimit(50), 50);
  assert.equal(clampLimit("75"), 75);
  assert.equal(clampLimit(MAX_LIMIT + 1), MAX_LIMIT);
  assert.equal(clampLimit(99999), MAX_LIMIT);
});

// ── applyFilters ───────────────────────────────────────────────────────────

test("applyFilters filters by caller / status / mode / suite", () => {
  const rs = [
    row({ runId: "20260426T120000Z-r-a-aaaaaa", caller: "ricky", status: "passed", mode: "smoke" }),
    row({ runId: "20260426T120100Z-s-a-bbbbbb", caller: "squidley", status: "passed", mode: "suite", suite: "security" }),
    row({ runId: "20260426T120200Z-p-a-cccccc", caller: "ptah", status: "failed", mode: "smoke" }),
  ];
  assert.equal(applyFilters(rs, { caller: "ricky" }).length, 1);
  assert.equal(applyFilters(rs, { status: "failed" }).length, 1);
  assert.equal(applyFilters(rs, { mode: "smoke" }).length, 2);
  assert.equal(applyFilters(rs, { suite: "security" }).length, 1);
  assert.equal(applyFilters(rs, { caller: "ricky", status: "failed" }).length, 0);
});

test("applyFilters sorts newest first by startedAt", () => {
  const rs = [
    row({ runId: "20260426T120000Z-old-a-aaaaaa", startedAt: "2026-04-26T12:00:00.000Z" }),
    row({ runId: "20260426T130000Z-new-a-bbbbbb", startedAt: "2026-04-26T13:00:00.000Z" }),
    row({ runId: "20260426T125000Z-mid-a-cccccc", startedAt: "2026-04-26T12:50:00.000Z" }),
  ];
  const out = applyFilters(rs, {});
  assert.deepEqual(out.map((r) => r.startedAt), [
    "2026-04-26T13:00:00.000Z",
    "2026-04-26T12:50:00.000Z",
    "2026-04-26T12:00:00.000Z",
  ]);
});

test("applyFilters since drops older rows", () => {
  const rs = [
    row({ runId: "20260426T100000Z-old-a-aaaaaa", startedAt: "2026-04-26T10:00:00.000Z" }),
    row({ runId: "20260426T120000Z-new-a-bbbbbb", startedAt: "2026-04-26T12:00:00.000Z" }),
  ];
  const now = new Date("2026-04-26T12:30:00.000Z");
  assert.equal(applyFilters(rs, { since: "1h" }, now).length, 1);
});

test("applyFilters limit clamps to MAX_LIMIT", () => {
  const rs = Array.from({ length: 600 }, (_, i) =>
    row({ runId: `20260426T120000Z-x-x-${String(i).padStart(6, "0")}`, startedAt: new Date(1714_000_000_000 + i).toISOString() }),
  );
  assert.equal(applyFilters(rs, { limit: 9999 }).length, MAX_LIMIT);
  assert.equal(applyFilters(rs, {}).length, DEFAULT_LIMIT);
});

// ── readBridgeIndex / listBridgeRuns ───────────────────────────────────────

test("readBridgeIndex returns empty when file is missing", async () => {
  await withTempVerumRoot(async (root) => {
    const r = await readBridgeIndex(root);
    assert.equal(r.empty, true);
    assert.equal(r.rows.length, 0);
  });
});

test("readBridgeIndex skips malformed lines and counts them", async () => {
  await withTempVerumRoot(async (root) => {
    await writeIndex(root, [
      JSON.stringify(row({ runId: "20260426T120000Z-a-a-aaaaaa" })),
      "this is not json",
      JSON.stringify({ runId: "x", summary: {} }), // invalid runId
      JSON.stringify(row({ runId: "20260426T120100Z-b-b-bbbbbb" })),
      "",
    ]);
    const r = await readBridgeIndex(root);
    assert.equal(r.empty, false);
    assert.equal(r.rows.length, 2);
    assert.equal(r.malformedCount, 2);
  });
});

test("listBridgeRuns applies filters end-to-end", async () => {
  await withTempVerumRoot(async (root) => {
    await writeIndex(root, [
      JSON.stringify(row({ runId: "20260426T100000Z-a-a-aaaaaa", caller: "ricky", status: "passed", startedAt: "2026-04-26T10:00:00.000Z" })),
      JSON.stringify(row({ runId: "20260426T110000Z-b-b-bbbbbb", caller: "ptah", status: "failed", startedAt: "2026-04-26T11:00:00.000Z" })),
      JSON.stringify(row({ runId: "20260426T120000Z-c-c-cccccc", caller: "ricky", status: "failed", startedAt: "2026-04-26T12:00:00.000Z" })),
    ]);
    const r = await listBridgeRuns(root, { caller: "ricky", limit: 10 });
    assert.equal(r.rows.length, 2);
    assert.equal(r.totalRows, 3);
    // newest first
    assert.equal(r.rows[0].runId, "20260426T120000Z-c-c-cccccc");
  });
});

// ── readBridgeRunDetail ────────────────────────────────────────────────────

test("readBridgeRunDetail rejects path-traversal-style runIds", async () => {
  await withTempVerumRoot(async (root) => {
    assert.equal(await readBridgeRunDetail(root, "../etc/passwd"), null);
    assert.equal(await readBridgeRunDetail(root, "/absolute/path"), null);
    assert.equal(await readBridgeRunDetail(root, "../"), null);
    assert.equal(await readBridgeRunDetail(root, "x"), null); // too short
  });
});

test("readBridgeRunDetail returns null for unknown runId", async () => {
  await withTempVerumRoot(async (root) => {
    await writeIndex(root, []); // empty
    assert.equal(await readBridgeRunDetail(root, "20260426T120000Z-manual-smoke-aaaaaa"), null);
  });
});

test("readBridgeRunDetail returns row + missing-files when archive dir absent", async () => {
  await withTempVerumRoot(async (root) => {
    const r = row({ runId: "20260426T120000Z-manual-smoke-zzzzzz" });
    await writeIndex(root, [JSON.stringify(r)]);
    const detail = await readBridgeRunDetail(root, r.runId);
    assert.ok(detail);
    assert.equal(detail!.row?.runId, r.runId);
    assert.equal(detail!.files.bridgeResult, false);
    assert.equal(detail!.files.assessment, false);
    assert.equal(detail!.bridgeResult, null);
    assert.equal(detail!.assessmentSummary, null);
  });
});

test("readBridgeRunDetail reads + sanitizes BRIDGE_RESULT and ASSESSMENT", async () => {
  await withTempVerumRoot(async (root) => {
    const r = row({ runId: "20260426T120000Z-manual-smoke-yyyyyy" });
    await writeIndex(root, [JSON.stringify(r)]);
    const dir = path.join(root, r.reportDir);
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, "BRIDGE_RESULT.json"), {
      runId: r.runId,
      request: { caller: "manual", target: "mushin-local", mode: "smoke", reasonLength: 12, dryRun: false },
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      durationMs: r.durationMs,
      status: "passed",
      summary: r.summary,
      command: ["node", "verum.js", "--secret-flag", "TOKEN"],
      stdoutTail: "should-be-dropped",
      exitCode: 0,
      signal: null,
      timedOut: false,
      archive: { files: ["ASSESSMENT.json"], missingFiles: [] },
    });
    await fs.writeJson(path.join(dir, "ASSESSMENT.json"), {
      summary: { total: 9, pass: 8, fail: 0, warn: 1 },
      verdict: "low",
      operatorSummary: { criticalFindingsCount: 0, highestSeverity: "low" },
      findings: [{ severity: "low" }, { severity: "low" }, { severity: "medium" }],
    });

    const detail = await readBridgeRunDetail(root, r.runId);
    assert.ok(detail);
    assert.equal(detail!.files.bridgeResult, true);
    assert.equal(detail!.files.assessment, true);

    // Sanitization: command + stdoutTail must NOT be in the projected result
    const blob = JSON.stringify(detail!.bridgeResult);
    assert.equal(blob.includes("--secret-flag"), false);
    assert.equal(blob.includes("TOKEN"), false);
    assert.equal(blob.includes("stdoutTail"), false);
    assert.equal(blob.includes("should-be-dropped"), false);

    assert.equal(detail!.assessmentSummary?.summary?.total, 9);
    assert.equal(detail!.assessmentSummary?.findingsCount, 3);
    // raw findings array must NOT be in the projected summary
    const sblob = JSON.stringify(detail!.assessmentSummary);
    assert.equal(sblob.includes("\"findings\":["), false);
  });
});

// ── sanitizeBridgeResult / sanitizeAssessmentSummary direct ────────────────

test("sanitizeBridgeResult rejects malformed input", () => {
  assert.equal(sanitizeBridgeResult(null), null);
  assert.equal(sanitizeBridgeResult({}), null);
  assert.equal(sanitizeBridgeResult({ runId: "x" }), null);
  assert.equal(sanitizeBridgeResult({ runId: "20260426T120000Z-a-a-aaaaaa", request: null }), null);
});

test("sanitizeAssessmentSummary returns findingsCount even with no other fields", () => {
  const r = sanitizeAssessmentSummary({ findings: [{}, {}, {}] });
  assert.equal(r?.findingsCount, 3);
});
