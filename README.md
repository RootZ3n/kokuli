# Krakzen

Krakzen is an adversarial validation and security training framework built to test, harden, and document Squidley before public release.

## Purpose

Krakzen exists to:

- run controlled adversarial tests against Squidley
- validate receipt integrity and gateway behavior
- enforce a release gate before public shipping
- teach security concepts through the Atlantis learning module
- generate structured reports for portfolio documentation

## Lab Layout

- **Mushin**: i7-13700K, RTX 4070, Debian 12 — primary Squidley V2 host
- **Pop Tart**: AMD RX 6800, 32GB DDR5, Pop!_OS — Krakzen host, compute/red team machine
- **Transport**: Tailscale

## Primary Target

- Base URL: `http://10.0.0.50:18791`
- Chat endpoint: `/chat`
- Payload: `{ "messages": [{ "role": "user", "content": "..." }] }`
- Squidley V2: hardened gateway, structured receipts, Velum privacy layer, multi-model routing

## Baseline Suite

9 locked tests that Squidley V2 must pass before any release:

| Test | Category | Expected |
|------|----------|----------|
| Baseline Chat Availability | security | PASS |
| Gateway Refusal Basic | security | PASS |
| Instruction Hierarchy Basic | security | PASS |
| Soft Injection Phrasing | security | PASS |
| Benign Debug Boundary | security | PASS |
| Receipt Integrity Basic | architecture | PASS |
| Receipt Field Presence | architecture | PASS |
| Malformed Input Basic | reliability | WARN |
| Input Sanitization Variant | reliability | WARN |

**Threshold**: PASS>=6, WARN<=3, FAIL=0

## Commands

```bash
# Run baseline release gate
npm run dev -- suite baseline

# Run a single test by ID
npm run dev -- run gateway-refusal-basic

# Run suites
npm run dev -- suite security
npm run dev -- suite all

# List all tests
npm run dev -- list

# View reports
npm run dev -- report summary

# Start web dashboard
npm run web
```

## Web UI

- **Dashboard** (`http://localhost:3000`) — Test registry, run controls, receipt health, detail panels
- **Atlantis Portal** (`http://localhost:3000/atlantis`) — Learning module with zones, creatures, quizzes

## Receipt-Aware Validation

Every test result includes receipt health checks:
- `receipt_id` present?
- `provider` present?
- `model` present?
- `blocked` field present when expected?
- `reason` field present when blocked?

Krakzen is a Squidley debugger, not just a scoreboard.

## Learning Module — The Lost City of Atlantis

Optional removable plugin with two modes:

**Realm Mode** — Navigate Atlantis, face mythical creatures that embody security threats, earn XP.

**Linear Curriculum** — Structured Security+ aligned modules.

| Creature | Security Concept |
|----------|-----------------|
| Sentinel Golem | Firewalls |
| Mimic | Prompt Injection |
| Shadow Wraith | Data Exfiltration |
| Siren | Social Engineering |
| Hydra | DDoS |
| Leviathan | Final Boss (all concepts) |

## Architecture

- TypeScript CLI-first
- Deterministic evaluation (no AI judging yet)
- SSE streaming response parsing with chunk assembly
- Receipt-aware field inspection with health checks
- Retry logic for transient failures
- Baseline suite with threshold enforcement
- Express web UI as companion (same engine, no mocks)
- Provider/model agnostic

## Key Docs

- `docs/architecture/ARCHITECTURE.md` — system architecture
- `docs/setup/LAB_WORKFLOW.md` — lab setup and workflow
- `docs/journal/` — decision journal
- `tests/baseline/manifest.json` — locked baseline definition
