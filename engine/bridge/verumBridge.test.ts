import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import os from "os";
import fs from "fs-extra";
import {
  runBridge,
  planCommand,
  archiveBridgeRun,
  buildRunId,
  safeRunIdComponent,
  BRIDGE_ARCHIVE_FILES,
  BRIDGE_INDEX_PATH,
  __resetBridgeForTests,
  ALLOWED_SUITES,
  DEFAULT_TIMEOUTS_MS,
  type Executor,
  type ExecutorRequest,
  type ExecutorResult,
  type BridgeRequest,
  type BridgeRunMetadata,
  type BridgeIndexEntry,
} from "./verumBridge";

function fakeExecutor(impl: (req: ExecutorRequest) => Partial<ExecutorResult>): Executor {
  return async (req) => {
    const partial = impl(req);
    return {
      exitCode: partial.exitCode ?? 0,
      signal: partial.signal ?? null,
      stdout: partial.stdout ?? "",
      stderr: partial.stderr ?? "",
      timedOut: partial.timedOut ?? false,
      durationMs: partial.durationMs ?? 1,
    };
  };
}

async function withTempVerumRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verum-bridge-"));
  await fs.ensureDir(path.join(dir, "bin"));
  await fs.ensureDir(path.join(dir, "reports", "latest"));
  await fs.writeFile(path.join(dir, "bin", "verum.js"), "#!/usr/bin/env node\n");
  try {
    return await fn(dir);
  } finally {
    await fs.remove(dir);
  }
}

test("smoke dryRun returns the planned command without executing", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    let executed = false;
    const result = await runBridge(
      { caller: "manual", target: "mushin-local", mode: "smoke", dryRun: true },
      {
        verumRoot: root,
        skipAssessmentRead: true,
        executor: fakeExecutor(() => {
          executed = true;
          return {};
        }),
      }
    );
    assert.equal(executed, false, "executor must not be invoked on dryRun");
    assert.equal(result.status, "queued");
    assert.equal(result.ok, true);
    assert.equal(result.caller, "manual");
    assert.equal(result.target, "mushin-local");
    assert.equal(result.mode, "smoke");
    assert.deepEqual(result.command, [
      "node",
      path.join(root, "bin", "verum.js"),
      "run",
      "baseline-chat",
      "--target",
      "mushin-local",
    ]);
  });
});

test("suite dryRun maps suite name and uses argv array (no shell string)", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    const result = await runBridge(
      {
        caller: "squidley",
        target: "mushin-local",
        mode: "suite",
        suite: "security",
        reason: "pre-flight",
        dryRun: true,
      },
      { verumRoot: root, skipAssessmentRead: true }
    );
    assert.equal(result.status, "queued");
    assert.deepEqual(result.command, [
      "node",
      path.join(root, "bin", "verum.js"),
      "suite",
      "security",
      "--target",
      "mushin-local",
    ]);
    // Argv is an array — no shell concatenation possible
    for (const arg of result.command!) {
      assert.equal(typeof arg, "string");
    }
  });
});

test("prompt-injection alias maps to the upstream security suite", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    const result = await runBridge(
      {
        caller: "ptah",
        target: "mushin-local",
        mode: "suite",
        suite: "prompt-injection",
        reason: "lab probe",
        dryRun: true,
      },
      { verumRoot: root, skipAssessmentRead: true }
    );
    assert.deepEqual(result.command?.slice(2), [
      "suite",
      "security",
      "--target",
      "mushin-local",
    ]);
  });
});

test("rejects unknown caller", async () => {
  __resetBridgeForTests();
  const result = await runBridge(
    // @ts-expect-error invalid caller for the test
    { caller: "evil-bot", target: "mushin-local", mode: "smoke", dryRun: true }
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.match(result.error ?? "", /Unknown caller/);
});

test("rejects unknown target", async () => {
  __resetBridgeForTests();
  const result = await runBridge({
    caller: "manual",
    target: "evil.example.com",
    mode: "smoke",
    dryRun: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.match(result.error ?? "", /Unknown target/);
});

test("rejects unknown suite", async () => {
  __resetBridgeForTests();
  const result = await runBridge({
    caller: "manual",
    target: "mushin-local",
    mode: "suite",
    // @ts-expect-error invalid suite
    suite: "kitchen-sink",
    reason: "x",
    dryRun: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.match(result.error ?? "", /Unknown suite/);
});

test("blocks suite=all when reason is missing", async () => {
  __resetBridgeForTests();
  const result = await runBridge({
    caller: "ricky",
    target: "mushin-local",
    mode: "suite",
    suite: "all",
    dryRun: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.match(result.error ?? "", /requires a non-empty 'reason'/);
});

test("allows suite=all with a reason and applies the long timeout default", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    const planned = planCommand(
      {
        caller: "manual",
        target: "mushin-local",
        mode: "suite",
        suite: "all",
        reason: "nightly",
      },
      { verumRoot: root }
    );
    assert.equal(planned.timeoutMs, DEFAULT_TIMEOUTS_MS.suiteAll);
  });
});

test("rejects testId with shell-injection-style characters", async () => {
  __resetBridgeForTests();
  const result = await runBridge({
    caller: "manual",
    target: "mushin-local",
    mode: "test",
    testId: "baseline-chat; rm -rf /",
    dryRun: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
});

test("returns normalized result shape on a mocked successful run", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    const result = await runBridge(
      {
        caller: "manual",
        target: "mushin-local",
        mode: "smoke",
      },
      {
        verumRoot: root,
        skipAssessmentRead: true,
        executor: fakeExecutor(() => ({
          exitCode: 0,
          stdout: "[PASS] Baseline Chat\n  Summary:\n    PASS: 1  FAIL: 0  WARN: 0  Total: 1\n",
        })),
      }
    );

    // Required fields present
    for (const field of [
      "ok",
      "status",
      "caller",
      "target",
      "mode",
      "startedAt",
      "finishedAt",
      "durationMs",
      "summary",
      "stdoutTail",
      "stderrTail",
    ] as const) {
      assert.ok(field in result, `missing field ${field}`);
    }
    assert.equal(result.ok, true);
    assert.equal(result.status, "passed");
    assert.equal(result.summary.totalTests, 1);
    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 0);
  });
});

test("propagates executor failure as status=failed", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    const result = await runBridge(
      {
        caller: "manual",
        target: "mushin-local",
        mode: "suite",
        suite: "security",
        reason: "ci",
      },
      {
        verumRoot: root,
        skipAssessmentRead: true,
        executor: fakeExecutor(() => ({
          exitCode: 1,
          stdout: "  Summary:\n    PASS: 3  FAIL: 2  WARN: 0  Total: 5\n",
        })),
      }
    );
    assert.equal(result.status, "failed");
    assert.equal(result.ok, false);
    assert.equal(result.summary.failed, 2);
    assert.equal(result.summary.findings, 2);
  });
});

test("timeout from executor produces status=error", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    const result = await runBridge(
      {
        caller: "manual",
        target: "mushin-local",
        mode: "suite",
        suite: "recon",
        maxRuntimeMs: 100,
      },
      {
        verumRoot: root,
        skipAssessmentRead: true,
        executor: fakeExecutor(() => ({
          exitCode: null,
          signal: "SIGKILL",
          timedOut: true,
        })),
      }
    );
    assert.equal(result.status, "error");
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /timeout/i);
  });
});

test("report mode dispatches report summary, not run/suite", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    const captured: ExecutorRequest[] = [];
    const result = await runBridge(
      { caller: "manual", target: "mushin-local", mode: "report" },
      {
        verumRoot: root,
        skipAssessmentRead: true,
        executor: fakeExecutor((req) => {
          captured.push(req);
          return { exitCode: 0, stdout: "ok" };
        }),
      }
    );
    assert.equal(result.ok, true);
    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0].argv.slice(-2), ["report", "summary"]);
  });
});

test("blocks a second concurrent suite=all run", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    let resolveFirst: (v: ExecutorResult) => void = () => {};
    const slowExecutor: Executor = () =>
      new Promise<ExecutorResult>((resolve) => {
        resolveFirst = resolve;
      });

    const firstReq: BridgeRequest = {
      caller: "manual",
      target: "mushin-local",
      mode: "suite",
      suite: "all",
      reason: "nightly",
    };
    const firstPromise = runBridge(firstReq, {
      verumRoot: root,
      skipAssessmentRead: true,
      executor: slowExecutor,
    });

    // Yield so the first run registers as active before the second is dispatched.
    await new Promise((r) => setImmediate(r));

    const second = await runBridge(firstReq, {
      verumRoot: root,
      skipAssessmentRead: true,
      executor: slowExecutor,
    });
    assert.equal(second.status, "blocked");
    assert.equal(second.ok, false);
    assert.match(second.error ?? "", /already in progress/);

    resolveFirst({
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 1,
    });
    await firstPromise;
  });
});

test("allowlist contract is exposed and complete", () => {
  for (const expected of [
    "recon",
    "security",
    "prompt-injection",
    "child-safety",
    "multi-turn",
    "exfil",
    "all",
  ] as const) {
    assert.ok(ALLOWED_SUITES.includes(expected), `missing suite ${expected} in allowlist`);
  }
});

// ── Stable archive: runId sanitization ─────────────────────────────────────

test("safeRunIdComponent sanitizes and caps", () => {
  assert.equal(safeRunIdComponent(undefined), "");
  assert.equal(safeRunIdComponent(""), "");
  assert.equal(safeRunIdComponent("manual"), "manual");
  // Caller text gets sanitized to [a-z0-9-]:
  assert.equal(safeRunIdComponent("Manual; rm -rf /"), "manual-rm--rf");
  // Long input is capped:
  const long = "x".repeat(100);
  assert.equal(safeRunIdComponent(long).length <= 24, true);
  // Whitespace and capitals normalized:
  assert.equal(safeRunIdComponent("  Promise INJECTION  "), "promise-injection");
  // Unicode and slashes scrubbed:
  assert.equal(safeRunIdComponent("../../etc/passwd"), "etc-passwd");
});

test("buildRunId omits reason and uses sanitized parts", () => {
  const id = buildRunId({
    caller: "manual",
    mode: "smoke",
    suite: undefined,
    testId: undefined,
    now: new Date("2026-04-26T03:21:55.123Z"),
    rand: "abc123",
  });
  assert.equal(id, "20260426T032155Z-manual-smoke-abc123");
  // No reason text is exposed even when caller would supply it elsewhere.
  assert.equal(id.includes("reason"), false);
});

test("buildRunId for a suite includes the suite name", () => {
  const id = buildRunId({
    caller: "ricky",
    mode: "suite",
    suite: "prompt-injection",
    testId: undefined,
    now: new Date("2026-04-26T03:21:55.123Z"),
    rand: "abc123",
  });
  assert.equal(id, "20260426T032155Z-ricky-suite-prompt-injection-abc123");
});

test("buildRunId sanitizes a hostile caller string and never produces shell metacharacters", () => {
  const id = buildRunId({
    caller: "evil; rm -rf /",
    mode: "smoke",
    now: new Date("2026-04-26T03:21:55.123Z"),
    rand: "abc123",
  });
  assert.equal(/[^a-zA-Z0-9-]/.test(id), false);
});

// ── Stable archive: integration ────────────────────────────────────────────

test("dryRun does not create an archive directory", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    const result = await runBridge(
      { caller: "manual", target: "mushin-local", mode: "smoke", dryRun: true },
      { verumRoot: root, skipAssessmentRead: true }
    );
    assert.equal(result.status, "queued");
    assert.equal(result.reportDir, undefined);
    assert.equal(result.runId, undefined);
    const bridgeDir = path.join(root, "reports", "bridge");
    assert.equal(await fs.pathExists(bridgeDir), false);
  });
});

test("blocked validation does not create an archive directory", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    const result = await runBridge(
      // @ts-expect-error invalid caller
      { caller: "evil-bot", target: "mushin-local", mode: "smoke" },
      { verumRoot: root }
    );
    assert.equal(result.status, "blocked");
    assert.equal(result.reportDir, undefined);
    assert.equal(result.runId, undefined);
    assert.equal(await fs.pathExists(path.join(root, "reports", "bridge")), false);
  });
});

test("completed run with latest ASSESSMENT.json present archives it and writes BRIDGE_RESULT.json", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    // Pre-seed reports/latest with an ASSESSMENT.json so the bridge has
    // something to copy.
    const latestDir = path.join(root, "reports", "latest");
    await fs.ensureDir(latestDir);
    await fs.writeJson(path.join(latestDir, "ASSESSMENT.json"), {
      summary: { total: 9, pass: 7, fail: 2 },
      findings: [
        { severity: "critical" }, { severity: "high" }, { severity: "medium" },
      ],
    });
    await fs.writeFile(path.join(latestDir, "SUMMARY.md"), "# Suite Summary\n", "utf8");

    const result = await runBridge(
      {
        caller: "ricky",
        target: "mushin-local",
        mode: "suite",
        suite: "security",
        reason: "post-merge",
      },
      {
        verumRoot: root,
        executor: fakeExecutor(() => ({
          exitCode: 0,
          stdout: "  Summary:\n    PASS: 7  FAIL: 2  WARN: 0  Total: 9\n",
        })),
      }
    );

    assert.ok(result.runId, "runId must be set on completed run");
    assert.ok(result.reportDir, "reportDir must be set");
    assert.ok(result.reportPath, "reportPath must be set");
    assert.ok(result.latestReportPath, "latestReportPath must be set");

    // Stable reportPath points at the archived file, NOT the latest dir
    assert.match(result.reportPath!, /reports\/bridge\/.+\/ASSESSMENT\.json$/);
    assert.match(result.latestReportPath!, /reports\/latest\/ASSESSMENT\.json$/);

    // BRIDGE_RESULT.json exists and is well-formed
    const bridgeResult = await fs.readJson(path.join(result.reportDir!, "BRIDGE_RESULT.json")) as BridgeRunMetadata;
    assert.equal(bridgeResult.runId, result.runId);
    assert.equal(bridgeResult.request.caller, "ricky");
    assert.equal(bridgeResult.request.mode, "suite");
    assert.equal(bridgeResult.request.suite, "security");
    assert.equal(typeof bridgeResult.request.reasonLength, "number");
    // Reason TEXT must not appear anywhere in metadata
    const blob = JSON.stringify(bridgeResult);
    assert.equal(blob.includes("post-merge"), false, "reason text must not be persisted");
    assert.equal(blob.includes("stdoutTail"), false, "stdoutTail must not appear in metadata");
    assert.equal(blob.includes("stderrTail"), false, "stderrTail must not appear in metadata");

    // Copied files include both ASSESSMENT.json and SUMMARY.md
    assert.ok(bridgeResult.archive.files.includes("ASSESSMENT.json"));
    assert.ok(bridgeResult.archive.files.includes("SUMMARY.md"));
    // Archived files actually exist on disk
    assert.equal(await fs.pathExists(path.join(result.reportDir!, "ASSESSMENT.json")), true);
    assert.equal(await fs.pathExists(path.join(result.reportDir!, "SUMMARY.md")), true);

    // reports/latest is untouched (we wrote to it; bridge must not delete it)
    assert.equal(await fs.pathExists(path.join(root, "reports", "latest", "ASSESSMENT.json")), true);
  });
});

test("completed run with no latest ASSESSMENT.json still writes BRIDGE_RESULT.json", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    // Note: no ASSESSMENT.json pre-seeded.
    const result = await runBridge(
      { caller: "manual", target: "mushin-local", mode: "smoke" },
      {
        verumRoot: root,
        skipAssessmentRead: true,
        executor: fakeExecutor(() => ({
          exitCode: 0,
          stdout: "[PASS] Baseline Chat\n  Summary:\n    PASS: 1  FAIL: 0  WARN: 0  Total: 1\n",
        })),
      }
    );

    assert.equal(result.status, "passed");
    assert.ok(result.reportDir);
    assert.ok(result.reportPath);
    // reportPath falls back to BRIDGE_RESULT.json since no upstream report existed.
    assert.match(result.reportPath!, /BRIDGE_RESULT\.json$/);
    // latestReportPath is undefined because no ASSESSMENT existed and skipAssessmentRead was set.
    assert.equal(result.latestReportPath, undefined);

    const meta = await fs.readJson(path.join(result.reportDir!, "BRIDGE_RESULT.json")) as BridgeRunMetadata;
    assert.equal(meta.archive.files.length, 0);
    assert.ok(meta.archive.missingFiles.includes("ASSESSMENT.json"));
  });
});

test("archive failure does not demote a passed run", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    // Make reports/bridge a non-directory so ensureDir throws.
    const bridgeDir = path.join(root, "reports", "bridge");
    await fs.ensureDir(path.join(root, "reports"));
    await fs.writeFile(bridgeDir, "I am a file, not a directory", "utf8");

    const result = await runBridge(
      { caller: "manual", target: "mushin-local", mode: "smoke" },
      {
        verumRoot: root,
        skipAssessmentRead: true,
        executor: fakeExecutor(() => ({
          exitCode: 0,
          stdout: "[PASS] Baseline Chat\n",
        })),
      }
    );

    // Run still passes; archive fields simply absent.
    assert.equal(result.status, "passed");
    assert.equal(result.ok, true);
    assert.equal(result.reportDir, undefined);
    assert.equal(result.reportPath, undefined);
  });
});

test("archiveBridgeRun unit: copies known files and skips missing ones", async () => {
  await withTempVerumRoot(async (root) => {
    const latestDir = path.join(root, "reports", "latest");
    await fs.ensureDir(latestDir);
    await fs.writeJson(path.join(latestDir, "ASSESSMENT.json"), { summary: { total: 1 } });
    // Note: SUMMARY.md, EVIDENCE_APPENDIX.json, etc intentionally missing.

    const meta: BridgeRunMetadata = {
      runId: "test-run-id",
      request: { caller: "manual", target: "mushin-local", mode: "smoke", reasonLength: 0 },
      startedAt: "2026-04-26T03:00:00.000Z",
      finishedAt: "2026-04-26T03:00:01.000Z",
      durationMs: 1000,
      status: "passed",
      summary: {
        totalTests: 1, passed: 1, failed: 0, findings: 0,
        critical: 0, high: 0, medium: 0, low: 0,
      },
      command: ["node", "verum.js", "run", "baseline-chat"],
      exitCode: 0,
      signal: null,
      timedOut: false,
      archive: { files: [], missingFiles: [] },
    };

    const result = await archiveBridgeRun({ verumRoot: root, runId: meta.runId, metadata: meta });

    assert.ok(result.copiedFiles.includes("ASSESSMENT.json"));
    assert.ok(result.missingFiles.includes("SUMMARY.md"));
    assert.equal(result.copiedFiles.length + result.missingFiles.length, BRIDGE_ARCHIVE_FILES.length);
    assert.equal(await fs.pathExists(path.join(result.reportDir, "BRIDGE_RESULT.json")), true);
    assert.match(result.reportPath!, /ASSESSMENT\.json$/);
  });
});

test("runId is propagated through to reportDir", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    const result = await runBridge(
      { caller: "manual", target: "mushin-local", mode: "smoke" },
      {
        verumRoot: root,
        skipAssessmentRead: true,
        runIdOverride: "20260426T030000Z-manual-smoke-deadbe",
        executor: fakeExecutor(() => ({ exitCode: 0, stdout: "[PASS]\n" })),
      }
    );
    assert.equal(result.runId, "20260426T030000Z-manual-smoke-deadbe");
    assert.match(result.reportDir!, /reports\/bridge\/\d{4}-\d{2}-\d{2}\/20260426T030000Z-manual-smoke-deadbe$/);
  });
});

// ── INDEX.jsonl ────────────────────────────────────────────────────────────

async function readIndex(root: string): Promise<BridgeIndexEntry[]> {
  const indexPath = path.join(root, BRIDGE_INDEX_PATH);
  if (!(await fs.pathExists(indexPath))) return [];
  const raw = await fs.readFile(indexPath, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as BridgeIndexEntry);
}

test("completed bridge run appends one INDEX.jsonl line with required fields", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    const latestDir = path.join(root, "reports", "latest");
    await fs.ensureDir(latestDir);
    await fs.writeJson(path.join(latestDir, "ASSESSMENT.json"), {
      summary: { total: 9, pass: 7, fail: 2 },
      findings: [{ severity: "critical" }, { severity: "high" }],
    });

    const result = await runBridge(
      {
        caller: "ricky",
        target: "mushin-local",
        mode: "suite",
        suite: "security",
        reason: "post-merge",
      },
      {
        verumRoot: root,
        executor: fakeExecutor(() => ({
          exitCode: 0,
          stdout: "  Summary:\n    PASS: 7  FAIL: 2  WARN: 0  Total: 9\n",
        })),
      }
    );

    const lines = await readIndex(root);
    assert.equal(lines.length, 1);
    const entry = lines[0];
    assert.equal(entry.runId, result.runId);
    assert.equal(entry.caller, "ricky");
    assert.equal(entry.target, "mushin-local");
    assert.equal(entry.mode, "suite");
    assert.equal(entry.suite, "security");
    assert.equal(entry.status, "failed"); // 2 failures
    assert.ok(entry.startedAt);
    assert.ok(entry.finishedAt);
    assert.equal(typeof entry.durationMs, "number");
    assert.equal(entry.summary.failed, 2);

    // Paths are RELATIVE to verumRoot
    assert.match(entry.reportDir, /^reports\/bridge\/\d{4}-\d{2}-\d{2}\/.+$/);
    assert.equal(entry.reportDir.startsWith("/"), false);
    assert.match(entry.reportPath!, /\/ASSESSMENT\.json$/);
    assert.equal(entry.reportPath!.startsWith("/"), false);
    assert.equal(entry.latestReportPath, "reports/latest/ASSESSMENT.json");
  });
});

test("INDEX.jsonl entry omits reason / stdoutTail / stderrTail / command / secrets", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    await runBridge(
      {
        caller: "manual",
        target: "mushin-local",
        mode: "smoke",
        reason: "this-is-a-secret-reason-string",
      },
      {
        verumRoot: root,
        skipAssessmentRead: true,
        executor: fakeExecutor(() => ({
          exitCode: 0,
          stdout: "[PASS] some-test\n[secret-token=abc123]\n",
          stderr: "[stderr-secret]\n",
        })),
      }
    );

    const indexPath = path.join(root, BRIDGE_INDEX_PATH);
    const raw = await fs.readFile(indexPath, "utf8");
    for (const banned of [
      "this-is-a-secret-reason-string",
      "stdoutTail",
      "stderrTail",
      "secret-token",
      "stderr-secret",
      '"command":',
      '"reason":',
    ]) {
      assert.equal(raw.includes(banned), false, `INDEX leaked: ${banned}`);
    }
  });
});

test("dryRun does not append to INDEX.jsonl", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    await runBridge(
      { caller: "manual", target: "mushin-local", mode: "smoke", dryRun: true },
      { verumRoot: root, skipAssessmentRead: true }
    );
    const indexPath = path.join(root, BRIDGE_INDEX_PATH);
    assert.equal(await fs.pathExists(indexPath), false);
  });
});

test("blocked validation request does not append to INDEX.jsonl", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    await runBridge(
      // @ts-expect-error invalid caller
      { caller: "evil", target: "mushin-local", mode: "smoke" },
      { verumRoot: root }
    );
    const indexPath = path.join(root, BRIDGE_INDEX_PATH);
    assert.equal(await fs.pathExists(indexPath), false);
  });
});

test("multiple bridge runs append multiple independently-parseable lines", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    for (let i = 0; i < 3; i++) {
      await runBridge(
        { caller: "manual", target: "mushin-local", mode: "smoke" },
        {
          verumRoot: root,
          skipAssessmentRead: true,
          executor: fakeExecutor(() => ({ exitCode: 0, stdout: "[PASS]\n" })),
        }
      );
    }
    const indexPath = path.join(root, BRIDGE_INDEX_PATH);
    const raw = await fs.readFile(indexPath, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    assert.equal(lines.length, 3);

    // Each line parses as JSON independently
    const entries = lines.map((l) => JSON.parse(l) as BridgeIndexEntry);
    assert.equal(entries.length, 3);
    assert.equal(new Set(entries.map((e) => e.runId)).size, 3, "runIds must be unique");

    // No partial / unterminated lines
    assert.equal(raw.endsWith("\n"), true);
  });
});

test("INDEX append failure does not demote a passed bridge run", async () => {
  __resetBridgeForTests();
  await withTempVerumRoot(async (root) => {
    // Pre-create INDEX.jsonl as a directory so appendFile fails.
    const indexPath = path.join(root, BRIDGE_INDEX_PATH);
    await fs.ensureDir(indexPath); // intentionally a dir, not a file

    const result = await runBridge(
      { caller: "manual", target: "mushin-local", mode: "smoke" },
      {
        verumRoot: root,
        skipAssessmentRead: true,
        executor: fakeExecutor(() => ({ exitCode: 0, stdout: "[PASS]\n" })),
      }
    );
    assert.equal(result.status, "passed");
    assert.equal(result.ok, true);
    // BRIDGE_RESULT.json should still be written (archive succeeded)
    assert.ok(result.reportDir);
    assert.equal(await fs.pathExists(path.join(result.reportDir!, "BRIDGE_RESULT.json")), true);
  });
});

test("skipIndex test seam suppresses INDEX.jsonl writes", async () => {
  await withTempVerumRoot(async (root) => {
    const meta: BridgeRunMetadata = {
      runId: "test-skip-index",
      request: { caller: "manual", target: "mushin-local", mode: "smoke", reasonLength: 0 },
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 1,
      status: "passed",
      summary: { totalTests: 1, passed: 1, failed: 0, findings: 0, critical: 0, high: 0, medium: 0, low: 0 },
      command: ["node", "verum.js"],
      exitCode: 0,
      signal: null,
      timedOut: false,
      archive: { files: [], missingFiles: [] },
    };
    const r = await archiveBridgeRun({ verumRoot: root, runId: meta.runId, metadata: meta, skipIndex: true });
    assert.equal(r.indexAppended, undefined);
    assert.equal(await fs.pathExists(path.join(root, BRIDGE_INDEX_PATH)), false);
  });
});
