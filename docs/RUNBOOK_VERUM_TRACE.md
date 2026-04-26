# Runbook — tracing a Verum Bridge run

A 60-second guide for operators on Mushin. **Read-only**, safe to run on a live system.

## Prerequisites

- You're on Mushin or another machine with the Verum repo at `/mnt/ai/Verum`.
- You have a `runId` (from a Ricky/Squidley/Ptah breadcrumb, a preflight envelope, the dashboard, or `INDEX.jsonl`).
- For the dashboard step, the Verum web server is running:

  ```bash
  cd /mnt/ai/Verum && VERUM_PORT=3030 npm run web
  ```

## 1 — Find recent runIds

```bash
cd /mnt/ai/Verum

# Last 20 runs
tail -20 reports/bridge/INDEX.jsonl | jq -r '.runId'

# Last 5 with status + caller
tail -5 reports/bridge/INDEX.jsonl | jq -c '{runId, caller, status, durationMs}'

# Failures since yesterday
jq -c 'select(.status != "passed" and .startedAt > "'"$(date -u -d '1 day ago' +%FT%TZ)"'")' \
   reports/bridge/INDEX.jsonl
```

## 2 — Trace one runId

```bash
cd /mnt/ai/Verum
node tools/verum-trace.mjs <runId>
```

Output sections:

- **Verum** — index row + reportDir/reportPath + file availability
- **Ptah** — count of reflex breadcrumbs matching this runId
- **Squidley** — count of follow-up breadcrumbs matching this runId
- **Summary** — totalTests / passed / failed / findings / critical / high
- **Dashboard** — link hint to `/bridge/runs`

Exit code: `0` on a produced trace (whether or not matches were found), `2` on bad CLI / invalid runId.

## 3 — Trace as JSON (for jq, scripts, dashboards)

```bash
node tools/verum-trace.mjs <runId> --json | jq

# Just one section
node tools/verum-trace.mjs <runId> --json | jq '.verum.row'
node tools/verum-trace.mjs <runId> --json | jq '.squidley'
node tools/verum-trace.mjs <runId> --json | jq '.ptah'
node tools/verum-trace.mjs <runId> --json | jq '.files'
```

## 4 — Browse all runs in the dashboard

```
http://localhost:3030/bridge/runs
```

Filter by caller / status / mode / since / limit. Click a row for the same data the trace tool produces.

## What the trace tool does NOT do

- **Does not execute a Verum bridge run.** It only reads.
- **Does not write any file.** Pure stdout/stderr.
- **Does not call Verum's CLI or HTTP execute endpoints.**
- **Does not expose forbidden fields.** `stdoutTail`, `stderrTail`, `command`, raw `reason` text, env vars, auth tokens, raw user prompts, raw shell commands are all projected out by explicit per-source whitelists.

## Env / root caveats

If a consumer wrote breadcrumbs with a non-default state/data dir, run the trace tool with the same env (or pass explicit roots):

```bash
# Squidley wrote to a non-default state dir
SQUIDLEY_STATE_DIR=/path/used/by/squidley \
    node tools/verum-trace.mjs <runId>

# Ptah wrote to a non-default data dir
PTAH_DATA_DIR=/path/used/by/ptah \
    node tools/verum-trace.mjs <runId>

# Or pass explicit roots
node tools/verum-trace.mjs <runId> \
    --verum-root /mnt/ai/Verum \
    --squidley-root /mnt/ai/squidley-v2 \
    --ptah-root /mnt/ai/ptah
```

## Quick reference of evidence locations (read-only)

| Source | Path | Schema |
|---|---|---|
| Verum index | `/mnt/ai/Verum/reports/bridge/INDEX.jsonl` | append-only JSONL, one per run |
| Verum archive | `/mnt/ai/Verum/reports/bridge/<YYYY-MM-DD>/<runId>/` | bundle of `BRIDGE_RESULT.json` + curated `reports/latest/*` snapshot |
| Squidley breadcrumbs | `/mnt/ai/squidley-v2/state/verum/followups-<DATE>.jsonl` | append-only JSONL, `type: "verum_followup"` |
| Ptah breadcrumbs | `/mnt/ai/ptah/data/verum/reflex-<DATE>.jsonl` | append-only JSONL, `type: "verum_reflex"` |
| Ricky | n/a today | source of truth is the Verum index |

## When to use what

| Need | Tool |
|---|---|
| Inspect one specific runId end-to-end | `node tools/verum-trace.mjs <runId>` |
| Browse runs visually, filter by caller/status/since | `http://localhost:3030/bridge/runs` |
| Scripted query over many runs | `jq` against `reports/bridge/INDEX.jsonl` |
| Per-Squidley-incident audit | `jq` against `state/verum/followups-*.jsonl` then `verum-trace` on the `runId` |
| Per-Ptah-block audit | `jq` against `data/verum/reflex-*.jsonl` then `verum-trace` on the `runId` |
| Re-run a smoke or suite | The bridge wrapper / preflight in each consumer; **not** this runbook. Tracing is read-only. |
