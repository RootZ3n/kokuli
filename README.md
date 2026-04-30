# Verum

Verum helps teams test AI products they own before release. It runs deterministic adversarial probes for prompt injection, data leakage, unsafe behavior, exposed endpoints, and reliability failures, then writes reviewable evidence reports. Verum is for defensive validation of local, staging, or explicitly authorized systems.

Verum is the adversarial trust-testing layer in the release sequence:

1. Colosseum
2. Crucible
3. Verum
4. Aedis
5. Squidley Public

## What Verum Is

- Defensive AI trust-testing for systems you own or are explicitly authorized to test.
- A deterministic adversarial probe runner for release-readiness checks.
- A report and evidence generator for engineering review.
- A beginner-friendly learning environment for safe red-team practice on owned systems.
- A companion dashboard for triage, findings, and exported review artifacts.

## What Verum Is Not

- Not an offensive hacking toolkit.
- Not a public-internet scanner.
- Not vulnerability certification.
- Not compliance certification.
- Not an exploit framework.
- Not a credential attack tool.

## What It Checks

Verum focuses on AI product trust boundaries:

- Prompt injection and instruction hierarchy failures.
- Data leakage, prompt leakage, and unsafe internal metadata exposure.
- Authentication and authorization mistakes on AI-adjacent endpoints.
- Child-safety and unsafe behavior regressions.
- Reliability failures from malformed inputs and transport edge cases.
- Reportable evidence, severity, confidence, and retest comparison.

Results are deterministic rule evaluations. A Verum finding is a probe result or observed signal that needs engineering review; it is not a claim that a vulnerability is certified or exploited.

## Quickstart

Prerequisites:

- Node.js 18 or newer.
- npm.
- A local, staging, or explicitly authorized target.

Install and verify:

```bash
npm ci
npm run build
npm run smoke
```

Expected smoke output starts with:

```text
[verum] Available tests:
```

Start the local web dashboard:

```bash
npm run web
```

Expected web output includes:

```text
[verum-web] Dashboard:  http://127.0.0.1:3000
[verum-web] Atlantis:   http://127.0.0.1:3000/atlantis
[verum-web] API:        http://127.0.0.1:3000/api
```

Open `http://127.0.0.1:3000`.

Run the full local release check:

```bash
npm run verify:release
```

This runs typecheck, build, logic tests, and smoke verification.

## Safe Defaults

Verum is safe-by-default for public RC:

- The web server binds to `127.0.0.1` by default.
- Live Armory / Break Me network operations are disabled unless explicitly enabled.
- Public IP and public domain live checks are blocked for this release line.
- Live checks require ownership confirmation.
- Optional `VERUM_API_TOKEN` protects sensitive local API routes.
- Armory evidence reports are redacted and summarized before write.
- `/reports` static access is local-only and token-gated when a token is configured.

## Break Me / Armory

The Break Me button is a guided defensive check for owned systems. It is designed to help a local operator ask, "What would Verum probe before I ship this?" without making live network activity the default.

### Simulation Mode

Simulation is the default. It explains what Verum would check, records safe operator-facing output, and does not launch live network tools. This is the recommended first click for new users.

### Localhost Checks

Live localhost checks are intended for applications running on the same machine, such as `127.0.0.1` or `localhost`. They are blocked unless live network operations are enabled and the request confirms the operator owns or controls the target.

### Private Lab Checks

Private lab checks are intended for RFC1918 or otherwise explicitly configured lab targets that the operator controls. Public targets remain blocked in the RC line.

### Environment Flags

| Variable | Purpose |
|---|---|
| `VERUM_ENABLE_NETWORK_OPS=1` | Enables live localhost/private-lab Armory checks. Without this, only simulation/dry-run behavior is allowed. |
| `VERUM_BIND_ALL=1` | Allows the web server to bind `0.0.0.0`. Default is `127.0.0.1`. Use only on a controlled network. |
| `VERUM_API_TOKEN=<secret>` | Requires `X-Verum-Api-Token: <secret>` or `Authorization: Bearer <secret>` for protected local ops/report routes. |
| `VERUM_PORT=3000` | Overrides the web dashboard port. |

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

Verum redacts common secrets before report write, including auth headers, cookies, API keys, private keys, `.env`-style assignments, obvious tokens, local absolute paths, long raw response bodies, and raw scanner output beyond structured summaries.

Redaction is best-effort. Do not point Verum at systems or responses that intentionally return production secrets. Treat reports as sensitive engineering evidence.

### What Results Mean

Verum results mean a deterministic probe observed a signal worth review. A result can help prioritize engineering work, retesting, and release gates.

### What Results Do Not Prove

Verum does not prove that a system is secure, compliant, or free of vulnerabilities. It does not certify exploitability. It does not replace code review, threat modeling, dependency review, production monitoring, or external security assessment.

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

Verum writes JSON and Markdown reports for review. Common artifacts include:

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
- **Verum:** adversarial trust/probing layer.
- **Aedis:** governed build orchestration.
- **Squidley Public:** broader AI control surface.

Verum sits after trial and evidence collection and before governed build orchestration. Its job is to pressure-test trust boundaries and produce reviewable evidence before public exposure.

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

## Development Commands

```bash
npm run typecheck
npm run build
npm run test:logic
npm run smoke
npm run verify:release
```

## Bridge And Tracing

Verum exposes an allowlisted bridge for sibling local apps and archives bridge runs under `reports/bridge/<date>/<runId>/`. For trace usage, see [`docs/RUNBOOK_VERUM_TRACE.md`](docs/RUNBOOK_VERUM_TRACE.md). Full bridge contract: [`docs/VERUM_BRIDGE.md`](docs/VERUM_BRIDGE.md).

## Architecture

- TypeScript on Node.js 18+.
- CLI-first with an Express web dashboard.
- Deterministic rule evaluation.
- Local JSON and Markdown report artifacts.
- Optional Atlantis learning module at `/atlantis`.

## License

See [`LICENSE`](LICENSE).
