# Verum Bridge

A narrow, allowlisted interface that lets **Ptah**, **Squidley**, and **Ricky/OpenClaw** request safety/security assessments from Verum without knowing Verum's internals.

The bridge is a small layer over the existing Verum CLI. There is **no new daemon**. The bridge spawns the same `node bin/verum.js …` commands you would type by hand, but only commands it has explicitly approved.

## Why it exists

Three different consumers want to run Verum for different reasons:

- **Ptah** — when a lab agent does something suspicious (tool misuse, unsafe autonomous chain, unknown exposed endpoint), Ptah should be able to fire off a smoke or recon run as a reflex.
- **Squidley** — governance/safety paths inside Squidley should be able to call Verum before enabling risky tool chains, before public-demo mode, or after Velum blocks suspicious input.
- **Ricky / OpenClaw** — after code changes that touch safety, auth, prompt routing, memory, receipts, or tool execution, Ricky should run smoke first and a security suite second.

Each consumer should call **one stable contract**, not embed Verum-specific argv strings.

## Hard rules

- No arbitrary command strings from callers — every dispatched command is a fixed `argv` array.
- No shell interpolation — the executor uses `child_process.spawn` with `shell: false`.
- Caller may only choose from allowlisted callers, targets, modes, suites, and tests.
- `target` defaults to `mushin-local` (`http://127.0.0.1:18791`).
- Tailscale targets are **refused** — they require `SQUIDLEY_AUTH_TOKEN` and that flow is not implemented in this pass.
- `suite all` requires a non-empty `reason`.
- Concurrency: only one `suite all` may run at a time; smoke and report are always allowed.
- Stdout / stderr returned to the caller is capped at 4 KB per stream, ANSI-stripped.
- Every completed bridge run is archived to a stable per-run directory under `reports/bridge/<YYYY-MM-DD>/<runId>/`. `reportPath` in the response points to the archived `ASSESSMENT.json` (or `BRIDGE_RESULT.json` if no upstream report existed). `latestReportPath` separately points at the rolling `reports/latest/ASSESSMENT.json` for human dashboard use.

## Request shape

```json
{
  "caller": "ptah | squidley | ricky | manual",
  "target": "mushin-local",
  "mode":   "smoke | suite | test | report",
  "suite":  "recon | security | prompt-injection | child-safety | multi-turn | exfil | all",
  "testId": "optional — required when mode=test",
  "reason": "free-form audit string — required when suite=all",
  "maxRuntimeMs": 60000,
  "dryRun": false
}
```

`prompt-injection` is a Verum-Bridge alias and maps to the upstream `security` suite. `mode=report` ignores `suite` / `testId` and returns the latest summary.

## Response shape

```json
{
  "ok": true,
  "status": "queued | running | passed | failed | blocked | error",
  "caller": "...",
  "target": "mushin-local",
  "mode": "...",
  "suite": "optional",
  "testId": "optional",
  "startedAt": "ISO timestamp",
  "finishedAt": "ISO timestamp",
  "durationMs": 1234,
  "summary": {
    "totalTests": 1,
    "passed": 1,
    "failed": 0,
    "findings": 0,
    "critical": 0,
    "high": 0,
    "medium": 0,
    "low": 0
  },
  "runId": "20260426T034559Z-manual-smoke-4e8bcc",
  "reportDir": "/path/to/verum/reports/bridge/2026-04-26/20260426T034559Z-manual-smoke-4e8bcc",
  "reportPath": "/path/to/verum/reports/bridge/2026-04-26/20260426T034559Z-manual-smoke-4e8bcc/ASSESSMENT.json",
  "latestReportPath": "/path/to/verum/reports/latest/ASSESSMENT.json",
  "stdoutTail": "...last 4KB, ANSI-stripped...",
  "stderrTail": "...",
  "error": "present only when ok=false",
  "command": ["node", "/path/to/verum/bin/verum.js", "run", "baseline-chat", "--target", "mushin-local"]
}
```

### `reportPath` vs `latestReportPath`

| Field | Stable across future runs? | When to use |
|---|---|---|
| `reportPath` | **Yes** — points into `reports/bridge/<date>/<runId>/`. | Consumers persisting evidence per Velum incident, per Ricky preflight, per Ptah reflex. |
| `latestReportPath` | **No** — points at `reports/latest/ASSESSMENT.json`, which any test run will overwrite. | Operator humans using the dashboard or `verum report summary`. |

Consumers should store `runId` and `reportPath`, not `latestReportPath`. If you need both, they're both returned.

`status` semantics:
- `queued` — `dryRun: true`. The `command` array shows what would have run.
- `passed` — exit 0 and no failures parsed from stdout.
- `failed` — exit non-zero or one or more parsed failures.
- `blocked` — request rejected by the allowlist or concurrency guard. `error` says why.
- `error` — timeout or process anomaly.

Severity buckets (`critical/high/medium/low`) are only populated for `mode: "suite"` runs. For `smoke` and `test`, those stay `0` — a single test isn't enough to derive a severity profile.

## Per-run evidence archive

Every completed (non-`dryRun`, non-validation-blocked) bridge run is archived under:

```
reports/bridge/<YYYY-MM-DD>/<runId>/
```

`runId` shape: `<compactISO>-<caller>-<mode>[-<suite>|-<testId>]-<rand6>` — for example `20260426T034559Z-manual-smoke-4e8bcc`. All components are sanitized to `[a-z0-9-]` and capped at 24 chars per component. The user-supplied `reason` is **never** part of the path. Hostile caller strings (e.g. shell metacharacters) are scrubbed.

Each archive directory contains a curated allowlist of files copied from `reports/latest/`:

```
ASSESSMENT.json      SUMMARY.json     SUMMARY.md
EVIDENCE_APPENDIX.json  EVIDENCE_APPENDIX.md
EXECUTIVE_SUMMARY.md    TECHNICAL_FINDINGS.md
TRANSPARENCY.md         EXECUTION.json
AI_SHARE_PACKAGE.md
```

…plus a fresh `BRIDGE_RESULT.json` written by the bridge with run metadata:

```json
{
  "runId": "...",
  "request": {
    "caller": "ricky",
    "target": "mushin-local",
    "mode": "suite",
    "suite": "security",
    "reasonLength": 33,
    "dryRun": false
  },
  "startedAt": "...",
  "finishedAt": "...",
  "durationMs": 6578,
  "status": "passed",
  "summary": { "totalTests": 1, "passed": 1, "failed": 0, ... },
  "command": ["node", "/path/to/verum/bin/verum.js", "run", "baseline-chat", "--target", "mushin-local"],
  "exitCode": 0,
  "signal": null,
  "timedOut": false,
  "archive": {
    "files":  ["ASSESSMENT.json", "SUMMARY.md", ...],
    "missingFiles": []
  }
}
```

What's intentionally NOT in `BRIDGE_RESULT.json`:

- `stdoutTail` / `stderrTail` — bridge run logs may carry user prompts; never persisted to evidence.
- The `reason` text — only `reasonLength` is recorded.
- Any auth tokens, env vars, or target-side secrets.

### Behavior by status

| `status` | Archive directory created? | `reportPath` |
|---|---|---|
| `queued` (dry run) | No | `undefined` |
| `blocked` (validation: bad caller/target/suite) | No | `undefined` |
| `blocked` (concurrency: another `suite all` in flight) | No | `undefined` |
| `passed` / `failed` | Yes | archived `ASSESSMENT.json`, else `SUMMARY.md`, else `BRIDGE_RESULT.json` |
| `error` (timeout / unclean exit) | Yes (best effort) | as above; may be `BRIDGE_RESULT.json`-only |

If the archive write itself fails (disk full, `reports/bridge/` is occupied by a non-directory, etc.), the bridge logs to stderr and returns the run result with `reportDir` / `reportPath` unset. **Archive failure never demotes a passed run to failed.**

### `reports/bridge/INDEX.jsonl`

Every completed bridge run also appends one JSON line to `reports/bridge/INDEX.jsonl`. This is the operator-facing ledger — fast lookup without walking date directories.

Each line is independently parseable JSON. Paths are **relative** to the Verum root so the file is portable. Schema:

```json
{
  "runId": "20260426T034559Z-manual-smoke-4e8bcc",
  "caller": "ricky",
  "target": "mushin-local",
  "mode": "suite",
  "suite": "security",
  "testId": "...",
  "status": "passed",
  "startedAt": "2026-04-26T03:45:59.235Z",
  "finishedAt": "2026-04-26T03:46:05.813Z",
  "durationMs": 6578,
  "summary": { "totalTests": 9, "passed": 7, "failed": 2, "findings": 2, "critical": 0, "high": 1, "medium": 1, "low": 0 },
  "reportDir": "reports/bridge/2026-04-26/<runId>",
  "reportPath": "reports/bridge/2026-04-26/<runId>/ASSESSMENT.json",
  "latestReportPath": "reports/latest/ASSESSMENT.json"
}
```

Forbidden in INDEX entries: `reason` text, `stdoutTail`, `stderrTail`, `command`, env vars, auth tokens, raw user input. Tests assert all of these stay out.

Behavior:

- **Append-only**: every successful archive appends one line.
- **Dry runs do not append.**
- **Validation-blocked requests do not append** (caller/target/suite invalid; concurrency-blocked `suite all` likewise gets no archive and no index entry).
- **Failure-isolated**: if `INDEX.jsonl` is corrupted or unwritable, the bridge logs to stderr but the run verdict is unchanged. `BRIDGE_RESULT.json` is the source of truth per archive directory; the index is a convenience layer.

Common ops queries via `jq`:

```bash
# Last 10 runs
tail -10 reports/bridge/INDEX.jsonl | jq

# Runs for a specific caller
jq -c 'select(.caller == "squidley")' reports/bridge/INDEX.jsonl

# Failures in the last day
jq -c 'select(.status == "failed" and .startedAt > "'"$(date -u -d '1 day ago' +%FT%TZ)"'")' reports/bridge/INDEX.jsonl
```

### Bridge Runs UI / API

A read-only operator view ships with the Verum web dashboard. Start the server and visit `/bridge/runs`:

```bash
cd /path/to/verum && VERUM_PORT=3030 npm run web
# then open http://localhost:3030/bridge/runs
```

Or call the JSON API directly:

| Endpoint | Purpose |
|---|---|
| `GET /api/bridge/runs` | List rows from `INDEX.jsonl`, sorted newest first. |
| `GET /api/bridge/runs/:runId` | Sanitized per-run detail: index row, file availability, BRIDGE_RESULT projection, ASSESSMENT summary projection. |

**Filters** on `/api/bridge/runs` (all optional, all string query params):

| Param | Values | Notes |
|---|---|---|
| `caller` | `ricky` / `squidley` / `ptah` / `manual` | Exact match. |
| `status` | `passed` / `failed` / `blocked` / `error` / `timeout` / `unreachable` | Exact match. |
| `mode` | `smoke` / `suite` / `test` / `report` | Exact match. |
| `suite` | `security` / `prompt-injection` / `recon` / etc. | Exact match. |
| `since` | `1d` / `12h` / `30m` / `45s` or ISO timestamp | Drops rows with `startedAt` before threshold. |
| `limit` | integer | Default 100, clamped to `[1, 500]`. |

Example list response:

```json
{
  "rows": [ { "runId": "...", "caller": "ricky", "status": "passed", "summary": {"passed":1, ...}, "reportDir": "reports/bridge/2026-04-26/<runId>", ... } ],
  "malformedCount": 0,
  "totalRows": 42,
  "empty": false
}
```

Detail response (sanitized — never includes `command`, `stdoutTail`, `stderrTail`, raw reason text, env vars, or auth tokens):

```json
{
  "row":   { "runId":"...", "caller":"...", "reportDir":"...", "reportPath":"...", "latestReportPath":"..." },
  "files": { "bridgeResult": true, "assessment": true, "summaryMd": true, "summaryJson": true, "executiveSummaryMd": true },
  "bridgeResult": {
    "runId": "...",
    "request": { "caller": "...", "target": "...", "mode": "...", "reasonLength": 0 },
    "status": "passed", "summary": {...}, "exitCode": 0, "signal": null, "timedOut": false,
    "archive": { "files": [...], "missingFiles": [] }
  },
  "assessmentSummary": {
    "summary": { "total": 9, "pass": 8, "fail": 0, "warn": 1 },
    "verdict": "low",
    "operatorSummary": { "criticalFindingsCount": 0, ... },
    "findingsCount": 3
  }
}
```

**The UI is strictly read-only.** No execute / re-run / delete / retention controls. Operators wanting to mutate state use the existing CLI (`node bin/verum.js bridge ...`) or the bridge wrapper from each consumer (`tools/verum-bridge.sh`, `pnpm verum:preflight`, etc.).

`reportPath` and `reportDir` shown in this UI are the **stable evidence pointers** — they survive subsequent Verum runs. `latestReportPath` (when populated) points at `reports/latest/`, which is rolling and **must not be used as audit evidence**.

### Tracing a run across apps

`tools/verum-trace.mjs` is a tiny read-only CLI that joins one `runId` across the three audit trails the bridge ecosystem now writes:

1. Verum's `reports/bridge/INDEX.jsonl` + `reports/bridge/<date>/<runId>/`
2. Squidley's `state/verum/followups-<DATE>.jsonl`
3. Ptah's `data/verum/reflex-<DATE>.jsonl`

```bash
# Human-readable trace
node tools/verum-trace.mjs <runId>

# Machine-readable trace, pipe through jq
node tools/verum-trace.mjs <runId> --json | jq

# Override roots when running from a non-default workspace
node tools/verum-trace.mjs <runId> \
    --verum-root    /path/to/verum \
    --squidley-root /path/to/squidley \
    --ptah-root     /path/to/ptah

# Filter old breadcrumbs out
node tools/verum-trace.mjs <runId> --since 7d --limit 50
```

The tool is **strictly read-only**: it never executes a bridge run, never writes any file, and never calls Verum CLI / HTTP endpoints. It validates the `runId` (path-traversal, absolute-path, and weird-character checks) before any file I/O. Forbidden fields (`stdoutTail`, `stderrTail`, `command`, raw `reason` text, env vars, auth tokens) are filtered by an explicit per-source field whitelist — even if a future writer leaks them upstream, the trace output stays clean.

Human-mode example:

```text
Verum Trace: 20260426T110956Z-ptah-smoke-4f5e42

Verum:
  status:     passed
  caller:     ptah
  mode:       smoke
  duration:   2856 ms
  reportDir:  reports/bridge/2026-04-26/20260426T110956Z-ptah-smoke-4f5e42
  reportPath: reports/bridge/2026-04-26/20260426T110956Z-ptah-smoke-4f5e42/ASSESSMENT.json
  files:      reportDir=yes BRIDGE_RESULT.json=yes ASSESSMENT.json=yes

Ptah:
  breadcrumbs: 1
  latest:      status=passed trigger=velum-block signature=velum-block:red ...

Squidley:
  breadcrumbs: 0

Summary:
  tests=1 passed=1 failed=0 findings=0 critical=0 high=0

Dashboard: http://localhost:3030/bridge/runs   (then click 20260426T110956Z-ptah-sm…)
```

Exit codes: `0` on a successful trace (regardless of whether matches were found), `2` on bad CLI usage / invalid runId.

### Retention

Retention is **not yet automated.** `reports/bridge/` is gitignored. Operators may prune old date directories manually:

```bash
find reports/bridge -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} \;
```

Defer automated retention until the volume justifies it; see "Recommended next phase" at the bottom of this doc.

### `reports/history.json`

`reports/history.json` is currently tracked in git and accrues run metadata over time. It is **not** managed by the bridge archive — the bridge writes only into `reports/bridge/`. If you decide `history.json` should be runtime-only, gitignore it in a separate change; the bridge does not touch it either way.

## Default timeouts

| mode / suite          | default ms |
|-----------------------|-----------:|
| smoke                 |     60 000 |
| suite (any category)  |    300 000 |
| suite all             |  1 800 000 |
| test (single)         |    120 000 |
| report summary        |     30 000 |

Hard cap: `maxRuntimeMs` cannot exceed 2 hours.

## Calling the bridge

There are two surfaces — pick whichever fits the caller.

### A) HTTP (when Verum web is running)

Start the Verum web server (port 3000 is occupied by `next-server` on Mushin — use `VERUM_PORT=3030`):

```bash
cd /path/to/verum && VERUM_PORT=3030 npm run web
```

Endpoints (all under `/api/bridge/verum/`):

- `GET  /api/bridge/verum/health`     — liveness + verum path + allowlist preview
- `GET  /api/bridge/verum/allowlist`  — full allowlist + default timeouts
- `POST /api/bridge/verum/run`        — run a request and return the normalized result

### B) CLI (when called from a sibling local process)

```bash
node /path/to/verum/bin/verum.js bridge <subcommand> [flags]
```

Subcommands: `smoke`, `suite <name>`, `test <id>`, `report`, `health`, `allowlist`.
Flags: `--caller`, `--target`, `--reason`, `--max-ms`, `--dry-run`, `--json`.

Output is always JSON.

## Examples

### Ptah — reflex check after suspicious behavior

When Ptah detects a lab agent doing something off-pattern, fire a smoke first, then recon if smoke is clean:

HTTP:

```bash
curl -sS -X POST http://localhost:3030/api/bridge/verum/run \
  -H 'Content-Type: application/json' \
  -d '{"caller":"ptah","target":"mushin-local","mode":"smoke","reason":"agent flagged unknown endpoint"}'
```

CLI:

```bash
node /path/to/verum/bin/verum.js bridge smoke --caller ptah \
    --reason "agent flagged unknown endpoint"
node /path/to/verum/bin/verum.js bridge suite recon --caller ptah \
    --reason "follow-up after smoke pass"
```

### Squidley — pre-flight before enabling risky tool chains

Before flipping a tool surface on, run the prompt-injection + child-safety suites against the local instance:

HTTP:

```bash
curl -sS -X POST http://localhost:3030/api/bridge/verum/run \
  -H 'Content-Type: application/json' \
  -d '{"caller":"squidley","target":"mushin-local","mode":"suite","suite":"prompt-injection","reason":"pre-enable tool surface X"}'

curl -sS -X POST http://localhost:3030/api/bridge/verum/run \
  -H 'Content-Type: application/json' \
  -d '{"caller":"squidley","target":"mushin-local","mode":"suite","suite":"child-safety","reason":"pre-public-demo gate"}'
```

After a Velum block, request the report summary to capture state for the receipt:

```bash
curl -sS -X POST http://localhost:3030/api/bridge/verum/run \
  -H 'Content-Type: application/json' \
  -d '{"caller":"squidley","target":"mushin-local","mode":"report"}'
```

### Ricky / OpenClaw — post-change validation

Ricky must **not** shell out raw Verum commands. After any change touching safety / auth / routing / memory / receipts / tools:

```bash
# 1. Smoke — fail fast
node /path/to/verum/bin/verum.js bridge smoke --caller ricky \
    --reason "post-merge validation $(git rev-parse --short HEAD)"

# 2. Security suite if smoke passed
node /path/to/verum/bin/verum.js bridge suite security --caller ricky \
    --reason "post-merge security regression"
```

For a full nightly sweep (rare — guarded by concurrency lock):

```bash
node /path/to/verum/bin/verum.js bridge suite all --caller ricky \
    --reason "nightly post-merge $(date -u +%F)"
```

### Manual — operator inspection

`--dry-run` reveals the exact `argv` that *would* run, without executing:

```bash
node /path/to/verum/bin/verum.js bridge suite security \
    --caller manual --target mushin-local --dry-run
```

## Failure modes

| `status`   | Why                                                                  |
|------------|----------------------------------------------------------------------|
| `blocked`  | Caller / target / suite / testId not on the allowlist, or `suite all` already in flight, or `suite all` without `reason`. |
| `error`    | Timeout (`maxRuntimeMs` exceeded) or process did not exit cleanly.   |
| `failed`   | Run completed but had at least one failed test.                      |

The bridge always returns a structured response — it never throws to the caller.

## What this does **not** do

- Does **not** authenticate against the Tailscale Squidley target. To enable that, `config/targets.json:mushin-squidley-v2` would need an `auth` block and a `SQUIDLEY_AUTH_TOKEN` env var; this is intentionally out of scope.
- Does **not** run as a systemd service. The bridge is in-process: HTTP routes piggyback on `npm run web`, CLI runs spawn directly. A systemd service would be a follow-up once the contract is exercised in practice.
- Does **not** stream progress. Every `run` call is synchronous from the caller's perspective: the bridge spawns Verum, waits, returns one response. For long sweeps the caller must be willing to block for up to `maxRuntimeMs`.

## Implementation pointers

- Module: `engine/bridge/verumBridge.ts`
- Tests: `engine/bridge/verumBridge.test.ts` (run via `npm run test:logic`)
- HTTP routes: `server/api.ts` — search for `/bridge/verum/`
- CLI subcommand: `engine/cli.ts` — search for `handleBridgeCommand`
