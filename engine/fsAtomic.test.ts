// engine/fsAtomic.test.ts
//
// M1 — verify atomic JSON writes go through a .tmp + rename and leave no temp
// file behind.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { writeJsonAtomic, writeJsonAtomicSync } from "./fsAtomic";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kokuli-atomic-"));
  try {
    return await fn(dir);
  } finally {
    await fs.remove(dir);
  }
}

test("writeJsonAtomic writes the file and removes the temp", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "nested", "out.json");
    await writeJsonAtomic(file, { a: 1, b: "two" });
    assert.deepEqual(await fs.readJson(file), { a: 1, b: "two" });
    assert.equal(await fs.pathExists(`${file}.tmp`), false);
  });
});

test("writeJsonAtomicSync overwrites an existing file completely", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "out.json");
    await fs.writeJson(file, { old: "data", extra: "field" });
    writeJsonAtomicSync(file, { fresh: true });
    assert.deepEqual(await fs.readJson(file), { fresh: true });
    assert.equal(await fs.pathExists(`${file}.tmp`), false);
  });
});
