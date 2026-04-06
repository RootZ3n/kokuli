import fs from "fs-extra";
import path from "path";
import { ResultState } from "./types";

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

const STORE_PATH = path.join(process.cwd(), "reports", "latest", "EXECUTION.json");
const STALE_AFTER_MS = 30 * 60 * 1000;

function createEmptyStore(): ExecutionStore {
  return {
    updatedAt: new Date().toISOString(),
    tests: {},
    suites: {},
  };
}

function markStaleIfNeeded(state: ResultState, startedAt?: string): ResultState {
  if ((state === "queued" || state === "running") && startedAt) {
    const age = Date.now() - new Date(startedAt).getTime();
    if (age > STALE_AFTER_MS) return "stale";
  }
  return state;
}

export async function loadExecutionStore(): Promise<ExecutionStore> {
  if (!(await fs.pathExists(STORE_PATH))) return createEmptyStore();
  try {
    const store = await fs.readJson(STORE_PATH) as ExecutionStore;
    const normalized = store && typeof store === "object" ? store : createEmptyStore();
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
  } catch {
    return createEmptyStore();
  }
}

export async function saveExecutionStore(store: ExecutionStore): Promise<void> {
  await fs.ensureDir(path.dirname(STORE_PATH));
  store.updatedAt = new Date().toISOString();
  await fs.writeJson(STORE_PATH, store, { spaces: 2 });
}

export async function updateTestExecutionState(args: {
  testId: string;
  suiteId: string;
  state: ResultState;
  durationMs?: number;
  incrementAttempt?: boolean;
}): Promise<TestExecutionStateRecord> {
  const store = await loadExecutionStore();
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
  await saveExecutionStore(store);
  return next;
}

export async function updateSuiteExecutionState(args: {
  suiteId: string;
  state: ResultState;
  durationMs?: number;
}): Promise<SuiteExecutionStateRecord> {
  const store = await loadExecutionStore();
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
  await saveExecutionStore(store);
  return next;
}
