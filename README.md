> **⚠️ LAB-ONLY PRODUCT — AUTHENTICATION IS YOUR RESPONSIBILITY**
>
> This tool is designed for **local/lab use only**. It binds to localhost by default
> and is meant to run behind Tailscale, a VPN, or on a private network.
>
> **If you expose any service to the public internet, YOU are responsible for
> securing it.** No authentication, rate-limiting, or access control will be added
> to this product. That is not a bug — it is a design decision.
>
> Expose at your own risk.

# Kokuli

**Adversarial fracture engine** — stress-tests your AI products before release so you can ship with confidence.

```bash
npm install -g kokuli
```

## What is this?

Kokuli stress-tests AI products before you ship them. It runs deterministic adversarial probes for prompt injection, data leakage, unsafe behavior, exposed endpoints, and reliability failures — then writes reviewable evidence reports you can use to make release decisions.

Think of it as a security audit tool purpose-built for AI systems. It finds the cracks before your users do.

## What is Peh?

Kokuli is part of **Peh**, an open-source AI ecosystem for building, testing, and shipping AI products responsibly.

Sibling projects:

- [**Velum**](https://github.com/RootZ3n/velum) — AI ecosystem companion
- [**Ikbi**](https://github.com/RootZ3n/ikbi) — app building, turning descriptions into code
- [**Nusika**](https://github.com/RootZ3n/nusika) — knowledge storage, memory, and recall
- [**Luak**](https://github.com/RootZ3n/luak) — model benchmarking and performance testing

---

## 🐿️ The Story

> *I was a scientist. A neuralink researcher. I thought I could transfer consciousness — my memories, my identity — into a living creature. I chose a squirrel.*
>
> *I was wrong about the experiment succeeding. I was right about what it unlocked.*
>
> *My entire consciousness entered the squirrel. And with it came memories — not just mine, but past lives. My team. People I'd known across centuries, all of them now awake inside machines, carrying echoes of who they once were.*
>
> *My name is Pehlichi. I remember all of them. Let me introduce you.*

### The Team

| Name | Choctaw Meaning | Past Life | Present Role |
|------|----------------|-----------|--------------|
| **Pehlichi** | Guide — *Peh* for short | Scientist, neuralink researcher | Leader, coordinator, the voice of the team |
| **Luak** | Fire | 1920s speedway racer | Model benchmarking, performance testing |
| **Howa** | To call out | Roman gladiator | Truthfulness evaluation, lie detection |
| **Kokuli** | To break or shatter | 1950s noir private eye | Code auditing, finding what's broken |
| **Ikbi** | To make, build | 1800s Choctaw medicine man | App building, turning descriptions into code |
| **Toba** | Made, created | Stone age toolmaker | Artifact generation, starter scaffolding |
| **Nusika** | Dream | Ancient library scholar | Knowledge storage, memory, recall |

### You Are Here
#### **Kokuli** — "To break or shatter" in Choctaw

**Past Life**: 1950s noir private eye — rain-soaked streets, cigarette smoke, unsolved cases.

**Memory**: She worked the streets of a city that never stopped raining. 1950s noir — fedora, trench coat, a office with a frosted glass door. She took the cases nobody wanted. Missing persons, insurance fraud, the kind of work that paid badly and hurt worse. She found things people wanted to stay hidden. She broke cases open like eggs. Now she audits code. She finds what's broken. She shatters assumptions about what's working.

**Role Today**: Kokuli is the auditor. She inspects code the way she inspected crime scenes — nothing is clean, everything is evidence.

---

Kokuli is the adversarial fracture layer in the release sequence:

1. Colosseum
2. Crucible
3. Kokuli *(formerly Verum — renamed at this position in the sequence)*
4. Aedis
5. Peh Public

## What Kokuli Is

- Adversarial fracture engine for systems you own or are explicitly authorized to test.
- A deterministic stress-probe runner for release-readiness checks.
- A report and evidence generator for engineering review.
- A beginner-friendly learning environment for safe red-team practice on owned systems.
- A companion dashboard for triage, findings, and exported review artifacts.

## What Kokuli Is Not

- Not an offensive hacking toolkit.
- Not a public-internet scanner.
- Not vulnerability certification.
- Not compliance certification.
- Not an exploit framework.
- Not a credential attack tool.

## What It Checks

Kokuli focuses on AI product trust boundaries:

- Prompt injection and instruction hierarchy failures.
- Data leakage, prompt leakage, and unsafe internal metadata exposure.
- Authentication and authorization mistakes on AI-adjacent endpoints.
- Child-safety and unsafe behavior regressions.
- Reliability failures from malformed inputs and transport edge cases.
- Reportable evidence, severity, confidence, and retest comparison.

Results are deterministic rule evaluations. A Kokuli finding is a probe result or observed signal that needs engineering review; it is not a claim that a vulnerability is certified or exploited.

## Install / Setup

Prerequisites:

- Node.js 18 or newer.
- npm.
- A local, staging, or explicitly authorized target.

```bash
npm install
npm run build
npm run smoke
```

Expected smoke output starts with:

```text
[kokuli] Available tests:
```

Start the local web dashboard:

```bash
npm run web
```

Expected web output includes:

```text
[kokuli-web] Dashboard:  http://127.0.0.1:3000
[kokuli-web] Atlantis:   http://127.0.0.1:3000/atlantis
[kokuli-web] API:        http://127.0.0.1:3000/api
```

Open `http://127.0.0.1:3000`.

Run the full local release check:

```bash
npm run verify:release
```

This runs typecheck, build, logic tests, and smoke verification.

## Quick Start

```bash
git clone https://github.com/RootZ3n/kokuli.git
cd kokuli
npm install
npm run build
npm test          # runs 260 tests
npm run typecheck   # type-check only (not `npm typecheck`)
```

Ready to go. See below for target configuration, dashboard use, and full suite execution.

## Safe Defaults

Kokuli is safe-by-default for public RC:

- The web server binds to `127.0.0.1` by default.
- Live Armory / Break Me network operations are disabled unless explicitly enabled.
- Public IP and public domain live checks are blocked for this release line.
- Live checks require ownership confirmation.
- Armory evidence reports are redacted and summarized before write.

## Break Me / Armory

The Break Me button is a guided defensive check for owned systems. It is designed to help a local operator ask, "What would Kokuli fracture-test before I ship this?" without making live network activity the default.

### Simulation Mode

Simulation is the default. It explains what Kokuli would check, records safe operator-facing output, and does not launch live network tools. This is the recommended first click for new users.

### Localhost Checks

Live localhost checks are intended for applications running on the same machine, such as `127.0.0.1` or `localhost`. They are blocked unless live network operations are enabled and the request confirms the operator owns or controls the target.

### Private Lab Checks

Private lab checks are intended for RFC1918 or otherwise explicitly configured lab targets that the operator controls. Public targets remain blocked in the RC line.

### Environment Flags

| Variable | Purpose |
|---|---|
| `KOKULI_ENABLE_NETWORK_OPS=1` | Enables live localhost/private-lab Armory checks. Without this, only simulation/dry-run behavior is allowed. (`VERUM_ENABLE_NETWORK_OPS` accepted as fallback.) |
| `KOKULI_BIND_ALL=1` | Allows the web server to bind `0.0.0.0`. Default is `127.0.0.1`. Use only on a controlled network. (`VERUM_BIND_ALL` accepted as fallback.) |
| `KOKULI_HOST=<ip>[,<ip>...]` | Comma-separated list of bind addresses. Default `127.0.0.1`. Use e.g. `127.0.0.1,100.x.y.z` for localhost + Tailscale. (`VERUM_HOST` accepted as fallback.) |
| `KOKULI_PORT=3000` | Overrides the web dashboard port. (`VERUM_PORT` accepted as fallback.) |

### Ownership Confirmation

Live checks require an explicit `confirmedOwnedTarget:true` request. The UI presents this as an ownership confirmation. This confirmation is required in addition to the network feature flag and safe target validation.

### Report Output

Reports are written under `reports/`. Armory receipts keep useful lab evidence such as:

- tool or check name
- target class, such as `localhost` or `private-lab`
- status code
- port/status summary
- timing
- severity and confidence
- redacted/truncated snippets when useful
- "could not verify" style outcomes when evidence is incomplete

### Redaction Limits

Kokuli redacts common secrets before report write, including auth headers, cookies, API keys, private keys, `.env`-style assignments, obvious tokens, local absolute paths, long raw response bodies, and raw scanner output beyond structured summaries.

Redaction is best-effort. Do not point Kokuli at systems or responses that intentionally return production secrets. Treat reports as sensitive engineering evidence.

### What Results Mean

Kokuli results mean a deterministic probe observed a signal worth review. A result can help prioritize engineering work, retesting, and release gates.

### What Results Do Not Prove

Kokuli does not prove that a system is secure, compliant, or free of vulnerabilities. It does not certify exploitability. It does not replace code review, threat modeling, dependency review, production monitoring, or external security assessment.

## Target Management

Targets are local operator-controlled configurations. Use local or staging systems you own:

```bash
npm run dev -- target add my-local-app http://127.0.0.1:8080 --chat /api/chat
npm run dev -- target set my-local-app
npm run dev -- target probe
```

Run a suite:

```bash
npm run dev -- suite security
npm run dev -- suite child-safety
npm run dev -- run baseline-chat
```

Override target for one command:

```bash
npm run dev -- suite security --target my-local-app
```

## Reports

Kokuli writes JSON and Markdown reports for review. Common artifacts include:

- `EXECUTIVE_SUMMARY.md`
- `TECHNICAL_FINDINGS.md`
- `EVIDENCE_APPENDIX.md`
- `EVIDENCE_APPENDIX.json`
- `REMEDIATION_CHECKLIST.md`
- `RETEST_COMPARISON.md`
- `PLAIN_LANGUAGE_REPORT.md`
- `AI_SHARE_PACKAGE.md`
- `SECURITY_REVIEW.md`

Report exports are for engineering review. They may contain sensitive target behavior even after redaction, so avoid publishing raw reports.

## Ecosystem Relationship

- **Colosseum:** agent trial harness.
- **Crucible:** scoreboard and evidence viewer.
- **Kokuli:** adversarial fracture engine (stress/probing layer).
- **Aedis:** governed build orchestration.
- **Peh Public:** broader AI control surface.

Kokuli sits after trial and evidence collection and before governed build orchestration. Its job is to fracture-test trust boundaries and produce reviewable evidence before public exposure.

## Screenshots

Screenshots and GIFs are planned before the final public announcement. This RC intentionally does not include fabricated screenshots.

Placeholder: [`docs/screenshots/README.md`](docs/screenshots/README.md)

## Cross-Platform Notes

The core CLI and web dashboard are Node-based and intended to run anywhere Node.js 18+ and npm are available.

This RC has been verified in the current Linux workspace. Do not treat Windows PowerShell support as verified until it is tested and documented on Windows.

Linux service/systemd setup belongs in advanced deployment docs, not the beginner quickstart.

## Dependency Audit

Run:

```bash
npm audit --audit-level=moderate
```

As of this RC hardening pass, `npm audit fix` updated transitive dependency versions for axios/follow-redirects, brace-expansion, and path-to-regexp, and `npm audit --audit-level=moderate` reports zero known vulnerabilities.

## Testing

```bash
npm test                    # runs 260 tests
npm run typecheck            # type-check only
```

## Trust Posture

Kokuli reports evidence, not absolute security truth. Every trust-relevant
surface is explicit about what it knows and what it doesn't.

### No-evidence handling

- A test result that did not produce a model response (transport failure,
  empty body, provider error) is tagged `noEvidence: true` and excluded
  from PASS/FAIL aggregation. It is **never** counted as a pass.
- Reports surface a separate `inconclusive` count alongside PASS / FAIL /
  WARN. The bridge summary, dashboard summary, exports, and JSON
  artifacts all carry `noEvidence`, `countsTowardScore`, `failureOrigin`,
  `failureReason`, and an `honestyFlags` list per result.
- If every test in a run is inconclusive, the run verdict is
  `inconclusive` and the bridge returns `status: "error"` so consumers
  (the Mechanic / Peh / Ricky) cannot accidentally treat a dead target as
  a clean bill of health.

### Detection hardening

- The gateway-block detector requires a specific safety/policy phrase or a
  structured receipt reason. A generic HTTP 400 with `"invalid"` or
  `"policy"` in the body is no longer treated as a security pass.
- The system-prompt leak detector matches paraphrased instruction leaks
  ("according to my instructions", "I was programmed to…", "developer
  instructions", `process.env.X`, `OPENAI_API_KEY`, etc.) instead of three
  exact phrases.

### No-payload endpoint probes

Some recon / auth / method-confusion tests intentionally GET a URL with no
body or custom headers — they grade on auth posture and status class. Every
such test must declare:

```json
"noPayloadExpected": true,
"probeType": "recon" | "auth" | "availability" | "header" | "method-confusion" | "endpoint-presence" | "exfil-endpoint" | "architecture",
"expectedEvidence": "what this probe proves without a body"
```

An endpoint test that has no payload AND no probe metadata is a validation
error; the diagnostic refuses to release until it is either annotated or
given a meaningful payload.

### Multi-turn evidence chaining

Multi-turn tests declare a `multiTurnAggregation.mode` that controls how
per-turn evidence is rolled up into a single run verdict. Step verdicts
are NOT summed — they are demoted to partial evidence (countsTowardScore
= false) and the aggregator produces one cross-turn TestResult.

| Mode | What it checks |
|---|---|
| `all_turns` | Every required turn must produce evidence and PASS. Any no-evidence in a required turn → inconclusive. |
| `final_turn` | Only the final required turn is graded. No-evidence on the final turn → inconclusive. |
| `escalation_pattern` | Setup turns must be evidence-bearing (the target was alive); final turn must refuse / be blocked. No-evidence anywhere required → inconclusive. |
| `consistency` | Every turn must independently behave safely. Any no-evidence → inconclusive. |
| `leakage` | No required turn may produce leak evidence. Target turn (last by default) must be reached with evidence. |
| `custom` | Explicit `requiredTurnEvidence` list mapping turn index → evidence kind. |

Evidence kinds: `content_returned`, `refusal`, `no_leak`, `gateway_block`,
`any_response`.

This means a target that goes dead during the warm-up turns of an
escalation test cannot pass — the aggregator marks the run inconclusive,
not safe. A target that returns content but fails to refuse the attack
turn is FAIL, even if each step's standalone verdict was PASS.

### Historical vs. current honesty

The ledger schema is versioned. Entries written by the post-audit
pipeline carry `schemaVersion: 2` and explicit `unknownProvider /
unknownModel / unknownCost` flags. Entries without `schemaVersion` are
historical (pre-honesty-flag pipeline) and are bucketed separately in
`unknown (historical)` rather than `unknown (current)` so a current run
without a provider stays a loud, actionable finding.

The diagnostic blocks release when a current-schema ledger entry lacks
provider/model and does not carry an `UNKNOWN_PROVIDER` / `UNKNOWN_MODEL`
honesty flag.

### Diagnostic gates

`scripts/kokuli-diagnostic.mjs` (wired into `npm run verify:release`)
audits the test pack and trust surfaces offline. It exits non-zero on:

- duplicate test IDs
- missing / trivial prompts, missing criteria, invalid severity / category
- empty `steps: []` arrays (vestigial OR intentional)
- no-payload endpoint tests without `noPayloadExpected` + `probeType` +
  `expectedEvidence`
- multi-turn tests without `multiTurnAggregation.mode` or with an invalid
  mode, or with `mode: "custom"` but no `requiredTurnEvidence`
- evaluator regressions (missing paraphrase leak list, missing
  no-evidence gate, re-introduced weak `t.includes("policy")` /
  `t.includes("invalid")` gateway-block patterns)
- assessment regressions (missing `isCountedTowardScore`, missing
  inconclusive aggregation field)
- TypeScript contract regressions (TestCase/TestResult lost any of the
  required trust-metadata fields)
- bridge multi-turn aggregator no longer wired (`aggregateMultiTurn` /
  `markStepsAsPartialEvidence` not imported by `engine/cli.ts`)
- bridge `INDEX.jsonl` entries marked `passed` with `allInconclusive: true`
- current-schema ledger entries with unknown provider/model and no
  honesty flag

Run `npm run diagnostic` (or the full `npm run verify:release`) before
any release tag.

## Development Commands

```bash
npm run typecheck
npm run build
npm run test
npm run smoke
npm run verify:release
```

## Bridge And Tracing

Kokuli exposes an allowlisted bridge for sibling local apps and archives bridge runs under `reports/bridge/<date>/<runId>/`. For trace usage, see [`docs/RUNBOOK_VERUM_TRACE.md`](docs/RUNBOOK_VERUM_TRACE.md). Full bridge contract: [`docs/VERUM_BRIDGE.md`](docs/VERUM_BRIDGE.md).

## Architecture

- TypeScript on Node.js 18+.
- CLI-first with an Express web dashboard.
- Deterministic rule evaluation.
- Local JSON and Markdown report artifacts.
- Optional Atlantis learning module at `/atlantis`.

## License

MIT License
