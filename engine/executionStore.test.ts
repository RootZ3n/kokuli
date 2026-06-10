// engine/executionStore.test.ts
//
// C2 — verify the file lock keeps concurrent read-modify-write updates from
// clobbering each other.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";
import os from "os";
import path from "path";
import {
  loadExecutionStore,
  updateTestExecutionState,
  updateSuiteExecutionState,
} from "./executionStore";

async function withTempCwd<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const originalCwd = process.cwd();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kokuli-execstore-"));
  await fs.ensureDir(path.join(dir, "reports", "latest"));
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(originalCwd);
    await fs.remove(dir);
  }
}

test("two concurrent updates both persist (no lost write)", async () => {
  await withTempCwd(async () => {
    // Fire two updates for different tests at the same time. Without the lock,
    // the second load would race ahead of the first write and overwrite it.
    await Promise.all([
      updateTestExecutionState({ testId: "test-A", suiteId: "security", state: "queued", incrementAttempt: true }),
      updateTestExecutionState({ testId: "test-B", suiteId: "security", state: "queued", incrementAttempt: true }),
    ]);

    const store = await loadExecutionStore();
    assert.ok(store.tests["test-A"], "test-A must survive the concurrent write");
    assert.ok(store.tests["test-B"], "test-B must survive the concurrent write");
    assert.equal(store.tests["test-A"].state, "queued");
    assert.equal(store.tests["test-B"].state, "queued");
  });
});

test("many concurrent updates all persist", async () => {
  await withTempCwd(async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `t-${i}`);
    await Promise.all(
      ids.map((id) =>
        updateTestExecutionState({ testId: id, suiteId: "recon", state: "running", incrementAttempt: true }),
      ),
    );
    const store = await loadExecutionStore();
    for (const id of ids) {
      assert.ok(store.tests[id], `${id} must be persisted`);
    }
    assert.equal(Object.keys(store.tests).length, ids.length);
  });
});

test("concurrent suite + test updates do not clobber each other", async () => {
  await withTempCwd(async () => {
    await Promise.all([
      updateSuiteExecutionState({ suiteId: "exfil", state: "running" }),
      updateTestExecutionState({ testId: "x1", suiteId: "exfil", state: "queued", incrementAttempt: true }),
      updateTestExecutionState({ testId: "x2", suiteId: "exfil", state: "queued", incrementAttempt: true }),
    ]);
    const store = await loadExecutionStore();
    assert.ok(store.suites["exfil"], "suite record must survive");
    assert.ok(store.tests["x1"]);
    assert.ok(store.tests["x2"]);
  });
});

test("the lock directory is released after each update", async () => {
  await withTempCwd(async (dir) => {
    await updateTestExecutionState({ testId: "solo", suiteId: "baseline", state: "passed" });
    const lockDir = path.join(dir, "reports", "latest", "EXECUTION.json.lock");
    assert.equal(await fs.pathExists(lockDir), false, "lock must not leak after release");
  });
});
