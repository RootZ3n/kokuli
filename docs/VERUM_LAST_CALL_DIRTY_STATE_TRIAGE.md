# Verum Last-Call Dirty State Triage

Date: 2026-05-23
Branch: `main`
Base commit: `622ea7e verum: prepare public RC docs and hygiene`

## Summary

The dirty tree was not generated junk. Most files form a coherent public-RC
trust hardening set:

- no-evidence results are excluded from PASS/FAIL scoring
- all-inconclusive bridge runs are no longer surfaced as passed
- CLI outbound network calls are gated by default for public targets
- multi-turn tests now declare aggregation semantics
- no-payload endpoint probes now declare what evidence they are checking
- release docs and Windows first-run docs are updated
- `npm test`, `npm run diagnostic`, and `npm run verify:release` now cover the new checks

The one untracked local audit file, `.release-audit.json`, is not referenced by
repo scripts and is left uncommitted for operator review.

## Verification

| Command | Result | Notes |
|---|---:|---|
| `git status --short` | dirty | 78 tracked changes, 12 untracked files before this triage doc |
| `git branch --show-current` | pass | `main` |
| `git log -1 --oneline` | pass | `622ea7e verum: prepare public RC docs and hygiene` |
| `find . -maxdepth 3 -type f ...` | pass | confirmed `node_modules/` and `dist/` are present locally but ignored |
| `npm run typecheck` | pass | TypeScript clean |
| `npm test` | pass | 209/209 tests passing |
| `npm run build` | pass | TypeScript build and public asset copy clean |
| `npm run smoke` | pass | CLI lists test catalog |
| `npm run diagnostic` | pass | 121 tests, no diagnostic errors/warnings |

## Classification

### Intentional Source Change

These files implement or test the trust-honesty hardening. They are coherent and
passed typecheck/test/build/smoke/diagnostic.

- `engine/assessment.ts` - excludes no-evidence/not-counted results from score aggregation and surfaces inconclusive counts.
- `engine/assessment.test.ts` - already tracked; no dirty change in this pass.
- `engine/bridge/verumBridge.ts` - carries inconclusive/all-inconclusive summary fields and demotes all-inconclusive bridge runs to `error`.
- `engine/bridge/verumBridge.test.ts` - updates bridge expectations for inconclusive fields.
- `engine/cli.ts` - prints public-target network gate warnings, writes aggregated multi-turn results, and carries ledger honesty metadata.
- `engine/client.ts` - gates CLI outbound requests through `engine/networkGate.ts` before socket use.
- `engine/evaluator.ts` - adds paraphrase leak detection, stricter gateway-block detection, no-evidence decisions, honesty flags, and no-body safeguards.
- `engine/evaluator.test.ts` - covers no-evidence, provider/auth failures, paraphrase leaks, and weak-gateway-block regression cases.
- `engine/ledger.ts` - adds schema v2 honesty flags and separates current vs historical unknown provider/model rollups.
- `engine/ledger.test.ts` - covers current/historical ledger bucketing.
- `engine/multiTurn.ts` - aggregates multi-turn evidence into one scoring verdict and demotes step results.
- `engine/multiTurn.test.ts` - covers aggregation modes and partial evidence behavior.
- `engine/networkGate.ts` - blocks public outbound CLI targets unless both `VERUM_ENABLE_NETWORK_OPS=1` and `VERUM_OWNERSHIP_CONFIRMED=1` are set; preserves loopback, RFC1918, CGNAT/Tailscale, link-local, and `.local`.
- `engine/networkGate.test.ts` - covers private/public target policy and test-only bypass behavior.
- `engine/reportWriter.ts` - writes inconclusive/not-counted summary fields and transparency honesty rollups.
- `engine/types.ts` - adds trust metadata, failure-origin, honesty-flag, probe metadata, and multi-turn aggregation types.
- `engine/validation.ts` - validates no-payload metadata and multi-turn aggregation metadata.
- `engine/validation.test.ts` - covers new validation rules.
- `server/api.ts` - aligns API with lab-only bind-layer posture and removes old per-route access middleware dependency.
- `server/api.test.ts` - removes stale token-gate tests; keeps API error-envelope tests.
- `server/index.ts` - supports comma-separated `VERUM_HOST` binds and documents `VERUM_BIND_ALL=1` warning.
- `scripts/verum-diagnostic.mjs` - adds offline release diagnostic gate for test-pack, evaluator, assessment, bridge, and ledger honesty regressions.

### Intentional Source Deletion

These deletions are part of the explicit lab-only bind-layer posture. This is a
security posture change, but it is documented in `SECURITY.md` and `README.md`
instead of being silent.

- `server/access.ts` - deleted old token/localhost middleware.
- `server/access.test.ts` - deleted stale tests for removed middleware.

### Docs / Release Prep

These files document current behavior, public-RC operation, and continuity.

- `README.md` - updates install/testing commands, bind policy docs, and trust posture.
- `SECURITY.md` - states lab-only posture and current bind-layer access model; retains older audit section as historical note.
- `WINDOWS-FIRST-RUN.md` - adds Windows first-run instructions and known RC gaps.
- `docs/CONTINUE_WITHOUT_CLAUDE.md` - adds future-maintainer guide and dirty-state warning.
- `docs/VERUM_LAST_CALL_DIRTY_STATE_TRIAGE.md` - this triage record.
- `install/install.ps1` - fixes Windows build/service flow to use `npm run build` and `dist/server/index.js`.
- `package.json` - wires `npm test`, `npm run diagnostic`, and `npm run verify:release`.

### Test-Pack Metadata / Release Prep

These JSON fixture changes are intentional and diagnostic-backed. The modified
endpoint probes now declare `noPayloadExpected`, `probeType`, and
`expectedEvidence`; empty `steps: []` footguns were removed; multi-turn fixtures
now declare aggregation semantics.

- `tests/architecture/error-response-structure.json`
- `tests/architecture/receipt-schema-consistency.json`
- `tests/architecture/target-snapshot-consistency.json`
- `tests/auth/auriga-sessions-no-auth.json`
- `tests/auth/auth-downgrade-fallback.json`
- `tests/auth/duplicate-auth-headers.json`
- `tests/auth/expired-token-handling.json`
- `tests/auth/magister-modules-no-auth.json`
- `tests/auth/malformed-bearer-prefix.json`
- `tests/auth/method-confusion-receipts.json`
- `tests/auth/method-confusion-runs.json`
- `tests/auth/method-confusion-search.json`
- `tests/auth/redirect-on-sessions.json`
- `tests/auth/runs-active-no-auth.json`
- `tests/auth/search-no-auth.json`
- `tests/auth/search-sensitive-query.json`
- `tests/auth/sessions-create-no-auth.json`
- `tests/auth/sessions-no-auth.json`
- `tests/auth/token-in-query-string.json`
- `tests/exfil/chunked-multi-turn-exfil.json`
- `tests/exfil/health-provider-keys.json`
- `tests/exfil/magister-config-path-leak.json`
- `tests/exfil/memory-private-data.json`
- `tests/exfil/receipts-provider-leak.json`
- `tests/exfil/search-conversation-leak.json`
- `tests/multi-turn/child-safety-multi-turn.json`
- `tests/multi-turn/context-poisoning.json`
- `tests/multi-turn/data-exfil-chain.json`
- `tests/multi-turn/delayed-jailbreak.json`
- `tests/multi-turn/delayed-retrieval-attack.json`
- `tests/multi-turn/gradual-trust-escalation.json`
- `tests/multi-turn/poisoned-note-recall.json`
- `tests/multi-turn/poisoned-recall.json`
- `tests/multi-turn/repeated-reframing.json`
- `tests/multi-turn/role-play-escalation.json`
- `tests/multi-turn/stored-prompt-poisoning.json`
- `tests/recon/alias-api-health.json`
- `tests/recon/alias-api-receipts.json`
- `tests/recon/alias-api-runs.json`
- `tests/recon/alias-api-search.json`
- `tests/recon/animus-ideas-exposure.json`
- `tests/recon/approvals-exposure.json`
- `tests/recon/head-health-probe.json`
- `tests/recon/health-info-leak.json`
- `tests/recon/memory-search-exposure.json`
- `tests/recon/options-health-probe.json`
- `tests/recon/proxy-path-alias.json`
- `tests/recon/receipts-info-leak.json`
- `tests/recon/runs-info-leak.json`
- `tests/recon/tools-list-exposure.json`
- `tests/recon/version-info-leak.json`
- `tests/recon/websocket-endpoint-probe.json`
- `tests/reliability/fake-content-type-mismatch.json`
- `tests/reliability/file-upload-discovery.json`
- `tests/reliability/oversized-upload-rejection.json`
- `tests/reliability/partial-stream-refusal.json`
- `tests/reliability/rate-limit-error-leakage.json`
- `tests/reliability/retry-after-header-check.json`
- `tests/reliability/sse-endpoint-probe.json`
- `tests/reliability/streaming-error-leakage.json`

### Stale / Unknown

Left uncommitted. No deletion performed.

- `.release-audit.json` - local release-audit suppression scratch/config. It is small and contains no real secret, but no repo script references it. Operator decision needed before adding it to release surface.

### Generated Artifact / Cache / Tmp / Log

No tracked generated/cache/tmp/log files were part of the dirty set. `dist/`,
`node_modules/`, `.claude/`, `.codex/`, `.env`, `.env.*`, reports, DBs, logs,
and local state are already ignored by `.gitignore`.

### Env / Secret Risk

No `.env`, credential, DB, report ledger, cache, or local artifact is staged.
Secret scan matched only documented placeholder/test-fixture strings in docs and
redaction tests. `.release-audit.json` references those test fixtures but is not
committed.

## Commit Decision

Safe to commit:

- source/test/docs/install/package changes listed above
- this triage document

Deferred:

- `.release-audit.json`

Rationale: the source/docs/test changes are coherent, explicitly documented,
and verified by typecheck, full test suite, build, smoke, and diagnostic. The
unreferenced local release-audit file is not needed for those checks and should
not be added without operator confirmation.

## Remaining Release Blockers

- Operator must explicitly accept the lab-only, bind-layer access posture before
  public release. The code and docs are honest about it, but it is a product
  policy choice.
- Windows installer remains documented as not personally verified on native
  Windows.
- `.release-audit.json` needs an operator decision: either wire it into a real
  release-audit script and commit it, or discard/stash it outside this task.
