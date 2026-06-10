# 2026-06-10 — Operational hardening (audit remediation)

Closed the operational blind spots from the senior-engineer operational audit
(`KOKULI-OPERATIONAL-AUDIT.md`): the same class of "in-memory state that doesn't
survive a restart, no file logging, no supervision" issues that affect the rest
of the lab. The code/architecture was already solid — these are runtime fixes.

## CRITICAL

- **C1 — File logging.** New `engine/logger.ts` mirrors every operational log to
  both the console and an append-only JSON-lines file at `reports/server.log`
  (`{timestamp, level, component, message}`), redacting credential-shaped
  strings before writing and rotating to `server.log.1` at 10 MB. Server
  startup, `server/api.ts`, `server/api-errors.ts`, and the bridge's
  `process.stderr.write` failures now route through it. Recent lines are exposed
  via `GET /api/meta/logs` (last 100, `?limit=` up to 1000). The detached
  background server is no longer a blind operator.
- **C2 — Execution-store concurrency.** `updateTest/SuiteExecutionState` now run
  their read-modify-write synchronously under an atomic `mkdir` lock
  (`EXECUTION.json.lock`), so concurrent API calls (or a bridge-spawned CLI
  child) can no longer clobber each other's state. Stale lock dirs are stolen
  after 30 s.
- **C3 — Bridge sweep-lock recovery.** `activeRuns` entries now carry a 10-min
  TTL (`KOKULI_BRIDGE_RUN_TTL_MS`); `fullSweepActive()` prunes stale entries so a
  SIGKILL'd run no longer blocks every later `suite=all`. Added
  `GET /api/bridge/kokuli/active-runs` and `POST /api/bridge/kokuli/unstuck`
  (plus `/bridge/verum/*` aliases).
- **C4 — Process supervision.** Added `install/verum-web.service.ready`, a
  concrete deployable systemd unit (real paths, setup header). Not enabled —
  installation is a deliberate operator step.

## HIGH

- **H1 — Ledger O(n²) I/O.** `recordEntry()` now appends one JSONL line instead
  of rewriting the whole array. `loadLedger()` parses line-by-line at startup,
  enforces `LEDGER_MAX_ENTRIES` (10k) and `LEDGER_RETENTION_DAYS` (90), and
  converts a legacy JSON-array ledger to JSONL on first load.
- **H2 — Unbounded `sessionEntries`.** Capped to `LEDGER_MAX_ENTRIES` (oldest
  shifted out on append).
- **H4 — Armory ghost runs.** `recoverStaleArmoryRuns()` runs at startup: a run
  left "running" in `ARMORY_STATUS.json` by a crashed process is marked failed
  and cleared, with a logged `pgrep nmap` hint for the orphaned child.
- **H5 — Invisible `console.error`.** Resolved by C1; `server/` now has zero bare
  console calls.

## MEDIUM

- **M1 — Atomic writes.** New `engine/fsAtomic.ts` (`.tmp` + `rename`) applied to
  EXECUTION.json, player.json, ARMORY_STATUS.json, armory-receipts.json (the
  ledger's JSONL writer already used tmp+rename).
- **M4 — Env least-privilege.** The bridge child now receives only
  PATH/HOME-class + `KOKULI_*`/`VERUM_*` env vars; provider API keys are
  withheld.

## Not fixed (by design)

- **H3 — `reports/latest/` empty.** An operational signal, not a bug: run a
  smoke test manually (`curl -X POST http://127.0.0.1:3000/api/tests/baseline-chat/run`)
  and confirm output appears.
- **M2** — false alarm (`multi-turn` is already in the valid list).
- **M3** — `0.0.0.0` bind without auth is an operator responsibility.

Test count: 209 → 232 (all green). `pnpm build && pnpm test` clean after each fix.
