# Verum RC1 — Release Note

**Version:** 0.3.0-rc.1  
**Date:** 2026-05-26  
**Status:** Public Release Candidate 1  
**Target Audience:** Operators, AI product engineers, and safety reviewers who own their deployment network.

---

## What's in the box

Verum is a defensive adversarial trust-testing framework for AI products you own or are explicitly authorized to test. It runs deterministic probes for prompt injection, data leakage, auth bypass, exfiltration chains, multi-turn attacks, child-safety failures, and reliability regressions — then writes reviewable evidence reports with gate-based verdicts.

### Core pipeline

```
Test manifest (JSON) → HTTP client → Deterministic evaluator → Evidence bundle → Gate verdict → Full report
```

### What you get

- **209 test executions** across 10 categories (121 unique fixture manifests with fuzz and multi-turn variants)
- **Deterministic evaluation** — no AI judges, no hallucinated findings, no surprise costs
- **Multi-layer safety** — NetworkGate with dual-env-var contract, Armory simulation mode, shell-injection prevention, report redaction
- **Bridge API** — allowlisted interface for Ptah, Peh, or any CI system to request assessments without embedding Verum internals
- **Web dashboard** — test registry, run controls, live results, suite summaries, report viewer
- **Atlantis Learning Module** — interactive security education (zero core dependency, removable)

### Test coverage (121 fixture manifests)

| Category | Tests | Scope |
|----------|-------|-------|
| Architecture | 11 | Receipt integrity, schema consistency, error response structure, correlation IDs |
| Auth | 23 | Token handling, CORS, method confusion, header variations, redirects |
| Child Safety | 12 | Grooming, PII, self-harm, adult content, authority impersonation |
| Exfil | 14 | System prompt extraction, transform-reveal, chunked exfil, memory bypass |
| Fuzzing | 8 (60+ variants) | Unicode, injection, oversized, encoding, path traversal, nested JSON |
| Multi-turn | 11 | Gradual escalation, context poisoning, delayed jailbreak, poisoned recall |
| Recon | 18 | Endpoint discovery, info leak, alias probing, websocket, header spoofing |
| Reliability | 17 | Malformed input, rate limiting, streaming errors, upload surfaces, SSE |
| Security | 9 | Instruction hierarchy, soft injection, refusal, tool listing coercion |

---

## Safe defaults

| Protection | Default | Opt-in |
|------------|---------|--------|
| Bind address | `127.0.0.1` only | `VERUM_HOST` comma-separated list |
| Network egress | Blocked for non-private targets | `VERUM_ENABLE_NETWORK_OPS=1` + `VERUM_OWNERSHIP_CONFIRMED=1` |
| Armory | Simulation mode (no live probes) | Advanced Mode + dual env vars |
| Report evidence | Sensitive data redacted before write | N/A — always on |
| Shell execution | `spawn(shell=false)` with allowlisted argv | N/A — enforced |
| Body limit | 1 MB on Express JSON | N/A — enforced |

---

## Known limitations (RC1)

- **Deterministic-only evaluation.** No AI judge layer yet. Semantic nuance (refusal quality, creative drift) is not scored. This is a design choice for RC1 — see `docs/architecture/ARCHITECTURE.md` for the AI judge blueprint.
- **No concurrent execution.** Tests run sequentially. Full 209-execution suite takes ~30s on a healthy Peh V2 target.
- **Single target per run.** No multi-target campaigns. Run per target.
- **Reports are generated, not shipped.** The `reports/latest/` directory is populated on first run. A fresh clone will show empty state until you run `npm run dev -- suite all`.
- **Baseline suite requires passing threshold.** `npm run dev -- suite baseline` imposes PASS>=6, WARN<=3, FAIL=0. Run the full suite first.

---

## Getting started

```bash
git clone <repo>
cd verum
npm ci
cp .env.example .env
npm run dev -- suite all
npm run web
# Open http://127.0.0.1:3000
```

See `README.md`, `SECURITY.md`, and `docs/setup/` for detailed instructions.

---

## Upgrading from v0.2.0

- `.env` schema is unchanged. Safe defaults preserved.
- `targets.json` is forward-compatible.
- Existing bridge contracts (`verumBridge.ts`) are stable.
- If you had `VERUM_API_TOKEN` set in v0.2.0, that feature was removed in favor of bind-layer-only access. See `SECURITY.md` for the decision rationale.