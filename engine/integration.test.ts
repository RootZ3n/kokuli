/**
 * Verum — Integration Test: Bridge smoke
 *
 * Covers the critical path: CLI → bridge dispatch → execution → result.
 * Uses a fake executor so no real HTTP calls are made.
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import os from "os";
import fs from "fs-extra";

async function withTempVerumRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verum-itest-"));
  await fs.ensureDir(path.join(dir, "reports", "latest"));
  await fs.writeFile(path.join(dir, "bin", "verum.js"), "#!/usr/bin/env node\n");
  try {
    return await fn(dir);
  } finally {
    await fs.remove(dir);
  }
}

test("bridge smoke returns ok with fake executor", async () => {
  await withTempVerumRoot(async (root) => {
    const { runBridge } = await import("./bridge/verumBridge");

    const result = await runBridge(
      { caller: "manual", target: "mushin-local", mode: "smoke", dryRun: false },
      {
        verumRoot: root,
        skipAssessmentRead: true,
        executor: async () => ({
          exitCode: 0,
          signal: null,
          stdout: '{"status":"ok"}',
          stderr: "",
          timedOut: false,
          durationMs: 10,
        }),
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.mode, "smoke");
  });
});
