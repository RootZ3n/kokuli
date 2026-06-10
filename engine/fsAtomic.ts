/**
 * Kokuli — atomic JSON writes (M1)
 *
 * Every persistent JSON file in Kokuli (EXECUTION.json, ledger, player.json,
 * ARMORY_STATUS.json, armory-receipts.json) used to be written with a plain
 * `fs.writeJson`, which truncates the destination and streams new bytes into
 * the same inode. A crash mid-write leaves the ONLY copy half-written and
 * unparseable.
 *
 * These helpers write to a sibling `<file>.tmp` and then `rename` it over the
 * destination. `rename(2)` is atomic on POSIX filesystems, so a reader either
 * sees the complete old file or the complete new file — never a torn write.
 */

import fs from "fs-extra";
import path from "path";

export interface AtomicWriteOptions {
  spaces?: number;
}

function tmpPath(file: string): string {
  return `${file}.tmp`;
}

/** Atomically write `data` as pretty JSON to `file` (async). */
export async function writeJsonAtomic(
  file: string,
  data: unknown,
  options: AtomicWriteOptions = { spaces: 2 },
): Promise<void> {
  const tmp = tmpPath(file);
  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(tmp, data, { spaces: options.spaces ?? 2 });
  await fs.rename(tmp, file);
}

/** Atomically write `data` as pretty JSON to `file` (synchronous). */
export function writeJsonAtomicSync(
  file: string,
  data: unknown,
  options: AtomicWriteOptions = { spaces: 2 },
): void {
  const tmp = tmpPath(file);
  fs.ensureDirSync(path.dirname(file));
  fs.writeJsonSync(tmp, data, { spaces: options.spaces ?? 2 });
  fs.renameSync(tmp, file);
}
