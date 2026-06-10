// engine/logger.test.ts
//
// C1 — verify the file logger appends JSON lines, redacts secrets, rotates at
// the size cap, and reads back via tailLog.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { writeLog, tailLog, redactSecrets, logger } from "./logger";

async function withTempCwd<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const originalCwd = process.cwd();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kokuli-logger-"));
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(originalCwd);
    await fs.remove(dir);
  }
}

test("writeLog appends parseable JSON lines to reports/server.log", async () => {
  await withTempCwd(async (dir) => {
    writeLog("info", "test-component", "hello world", { console: false });
    writeLog("error", "other", "boom", { console: false });

    const raw = await fs.readFile(path.join(dir, "reports", "server.log"), "utf8");
    const lines = raw.trim().split("\n");
    assert.equal(lines.length, 2);

    const first = JSON.parse(lines[0]);
    assert.equal(first.level, "info");
    assert.equal(first.component, "test-component");
    assert.equal(first.message, "hello world");
    assert.ok(typeof first.timestamp === "string" && first.timestamp.length > 0);

    const second = JSON.parse(lines[1]);
    assert.equal(second.level, "error");
    assert.equal(second.message, "boom");
  });
});

test("tailLog reads back the last N entries newest-last", async () => {
  await withTempCwd(async () => {
    for (let i = 0; i < 10; i++) {
      logger.fileOnly("info", "loop", `entry ${i}`);
    }
    const entries = tailLog(3);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].message, "entry 7");
    assert.equal(entries[2].message, "entry 9");
  });
});

test("secret redaction masks tokens before they hit disk", async () => {
  await withTempCwd(async (dir) => {
    writeLog("info", "auth", 'authorization: Bearer abc123secrettoken', { console: false });
    writeLog("info", "auth", "key sk-proj-ABCDEFGH12345678", { console: false });
    writeLog("info", "auth", 'api_key="supersecretvalue"', { console: false });

    const raw = await fs.readFile(path.join(dir, "reports", "server.log"), "utf8");
    assert.doesNotMatch(raw, /abc123secrettoken/);
    assert.doesNotMatch(raw, /sk-proj-ABCDEFGH12345678/);
    assert.doesNotMatch(raw, /supersecretvalue/);
    assert.match(raw, /\[REDACTED\]/);
  });
});

test("redactSecrets is a pure function over common credential shapes", () => {
  assert.match(redactSecrets("Bearer deadbeefcafe"), /\[REDACTED\]/);
  assert.match(redactSecrets("token=hunter2hunter2"), /\[REDACTED\]/);
  assert.equal(redactSecrets("nothing sensitive here"), "nothing sensitive here");
});

test("log file rotates to server.log.1 when over the size cap", async () => {
  await withTempCwd(async (dir) => {
    const logFile = path.join(dir, "reports", "server.log");
    await fs.ensureDir(path.dirname(logFile));
    // Seed a file already past the 10 MB cap.
    await fs.writeFile(logFile, "x".repeat(10 * 1024 * 1024 + 1));

    writeLog("info", "rotate", "after rotation", { console: false });

    assert.ok(await fs.pathExists(`${logFile}.1`), "rotated file should exist");
    const fresh = await fs.readFile(logFile, "utf8");
    // The fresh active log holds only the new line, not the 10 MB of padding.
    assert.ok(fresh.length < 1024);
    assert.match(fresh, /after rotation/);
  });
});
