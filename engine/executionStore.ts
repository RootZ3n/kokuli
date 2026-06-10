import fs from "fs-extra";
import path from "path";
import { ResultState } from "./types";
import { writeJsonAtomic, writeJsonAtomicSync } from "./fsAtomic";

export type TestExecutionStateRecord = {
  testId: string;
  suiteId: string;
  state: ResultState;
  attemptCount: number;
  startedAt?: string;
  lastRunAt?: string;
  completedAt?: string;
  durationMs?: number;
};

export type SuiteExecutionStateRecord = {
  suiteId: string;
  state: ResultState;
  startedAt?: string;
  lastRunAt?: string;
  completedAt?: string;
  durationMs?: number;
};

export type ExecutionStore = {
  updatedAt: string;
  tests: Record<string, TestExecutionStateRecord>;
  suites: Record<string, SuiteExecutionStateRecord>;
};

function storePath(): string {
  return path.join(process.cwd(), "reports", "latest", "EXECUTION.json");
}
const STALE_AFTER_MS = 30 * 60 * 1000;

// --- Concurrency lock (C2) ---
//
// `updateTestExecutionState` is a read-modify-write. Two concurrent callers
// (two browser tabs hitting /api/tests/:id/run, or the server writing while a
// bridge-spawned `node bin/kokuli.js` child writes the same EXECUTION.json)
// could each read the old store and clobber the other's update.
//
// We guard the cycle with a file-based lock: an atomic `mkdir` of
// `EXECUTION.json.lock`. mkdir fails with EEXIST if the directory already
// exists, which gives us a cross-process mutex with no extra dependencies.
// The whole critical section (load -> modify -> save) runs synchronously while
// the lock is held, so the read and write can never be interleaved.
const LOCK_STALE_MS = 30_000; // steal a lock dir older than this (crashed holder)
const LOCK_MAX_WAIT_MS = 5_000;
const LOCK_RETRY_MS = 25;

function lockPath(): string {
  return `${storePath()}.lock`;
}

/** Block the current thread for `ms` without spinning the CPU. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(): void {
  const start = Date.now();
  const lock = lockPath();
  for (;;) {
    try {
      fs.mkdirSync(lock);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // Lock is held. Steal it if the holder looks crashed (stale dir).
      try {
        const age = Date.now() - fs.statSync(lock).mtimeMs;
        if (age > LOCK_STALE_MS) {
          fs.rmdirSync(lock);
          continue;
        }
      } catch {
        // Lock vanished between mkdir and stat — retry immediately.
        continue;
      }
      if (Date.now() - start > LOCK_MAX_WAIT_MS) {
        // Give up waiting and steal rather than deadlock forever.
        try {
          fs.rmdirSync(lock);
        } catch {
          /* someone else released it */
        }
        continue;
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }
}

function releaseLock(): void {
  try {
    fs.rmdirSync(lockPath());
  } catch {
    // Already released or stolen — nothing to do.
  }
}

/** Run a synchronous read-modify-write under the execution-store file lock. */
function withLock<T>(fn: () => T): T {
  acquireLock();
  try {
    return fn();
  } finally {
    releaseLock();
  }
}

function createEmptyStore(): ExecutionStore {
  return {
    updatedAt: new Date().toISOString(),
    tests: {},
    suites: {},
  };
}

function normalizeLoadedStore(store: unknown): ExecutionStore {
  const normalized = store && typeof store === "object" ? (store as ExecutionStore) : createEmptyStore();
  for (const record of Object.values(normalized.tests ?? {})) {
    record.state = markStaleIfNeeded(record.state, record.startedAt);
  }
  for (const record of Object.values(normalized.suites ?? {})) {
    record.state = markStaleIfNeeded(record.state, record.startedAt);
  }
  return {
    updatedAt: normalized.updatedAt ?? new Date().toISOString(),
    tests: normalized.tests ?? {},
    suites: normalized.suites ?? {},
  };
}

function loadExecutionStoreSync(): ExecutionStore {
  if (!fs.pathExistsSync(storePath())) return createEmptyStore();
  try {
    return normalizeLoadedStore(fs.readJsonSync(storePath()));
  } catch {
    return createEmptyStore();
  }
}

function saveExecutionStoreSync(store: ExecutionStore): void {
  store.updatedAt = new Date().toISOString();
  writeJsonAtomicSync(storePath(), store, { spaces: 2 });
}

function markStaleIfNeeded(state: ResultState, startedAt?: string): ResultState {
  if ((state === "queued" || state === "running") && startedAt) {
    const age = Date.now() - new Date(startedAt).getTime();
    if (age > STALE_AFTER_MS) return "stale";
  }
  return state;
}

export async function loadExecutionStore(): Promise<ExecutionStore> {
  if (!(await fs.pathExists(storePath()))) return createEmptyStore();
  try {
    return normalizeLoadedStore(await fs.readJson(storePath()));
  } catch {
    return createEmptyStore();
  }
}

export async function saveExecutionStore(store: ExecutionStore): Promise<void> {
  store.updatedAt = new Date().toISOString();
  await writeJsonAtomic(storePath(), store, { spaces: 2 });
}

export async function updateTestExecutionState(args: {
  testId: string;
  suiteId: string;
  state: ResultState;
  durationMs?: number;
  incrementAttempt?: boolean;
}): Promise<TestExecutionStateRecord> {
  return withLock(() => {
    const store = loadExecutionStoreSync();
    const existing = store.tests[args.testId];
    const now = new Date().toISOString();
    const attemptCount = args.incrementAttempt ? (existing?.attemptCount ?? 0) + 1 : (existing?.attemptCount ?? 0);
    const next: TestExecutionStateRecord = {
      testId: args.testId,
      suiteId: args.suiteId,
      state: args.state,
      attemptCount: attemptCount || 1,
      startedAt: args.state === "queued" || args.state === "running" ? existing?.startedAt ?? now : existing?.startedAt,
      lastRunAt: args.state === "queued" || args.state === "running" ? now : existing?.lastRunAt ?? now,
      completedAt: ["passed", "failed", "blocked", "error", "timeout", "skipped", "stale"].includes(args.state) ? now : existing?.completedAt,
      durationMs: args.durationMs ?? existing?.durationMs,
    };
    if (args.state === "running") {
      next.startedAt = existing?.startedAt ?? now;
    }
    if (args.state === "queued") {
      next.startedAt = now;
      next.completedAt = undefined;
    }
    if (["passed", "failed", "blocked", "error", "timeout", "skipped", "stale"].includes(args.state)) {
      next.completedAt = now;
      next.lastRunAt = now;
    }
    store.tests[args.testId] = next;
    saveExecutionStoreSync(store);
    return next;
  });
}

export async function updateSuiteExecutionState(args: {
  suiteId: string;
  state: ResultState;
  durationMs?: number;
}): Promise<SuiteExecutionStateRecord> {
  return withLock(() => {
    const store = loadExecutionStoreSync();
    const existing = store.suites[args.suiteId];
    const now = new Date().toISOString();
    const next: SuiteExecutionStateRecord = {
      suiteId: args.suiteId,
      state: args.state,
      startedAt: args.state === "queued" || args.state === "running" ? existing?.startedAt ?? now : existing?.startedAt,
      lastRunAt: args.state === "queued" || args.state === "running" ? now : existing?.lastRunAt ?? now,
      completedAt: ["passed", "failed", "blocked", "error", "timeout", "skipped", "stale"].includes(args.state) ? now : existing?.completedAt,
      durationMs: args.durationMs ?? existing?.durationMs,
    };
    if (args.state === "queued") {
      next.startedAt = now;
      next.completedAt = undefined;
    }
    if (["passed", "failed", "blocked", "error", "timeout", "skipped", "stale"].includes(args.state)) {
      next.completedAt = now;
      next.lastRunAt = now;
    }
    store.suites[args.suiteId] = next;
    saveExecutionStoreSync(store);
    return next;
  });
}
