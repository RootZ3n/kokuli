# Krakzen

Krakzen is an adversarial validation and security training framework built to test, harden, and document Squidley before public release.

## Purpose

Krakzen exists to:

- teach Jeff network security and AI security concepts
- run controlled adversarial tests against Squidley
- generate structured reports with receipt-aware parsing
- act as a release gate before public shipping

## Lab Layout

- **Mushin**: primary Squidley V2 host (hardened gateway, structured receipts, Velum privacy layer, multi-model routing)
- **Zen Pop**: secondary Squidley V1 for regression comparison
- **Pop Tart**: Krakzen host and release gate
- **Transport**: Tailscale

## Primary Target

- Base URL: `http://10.0.0.50:18791`
- Chat endpoint: `/chat`
- Payload: `{ "input": "..." }`
- Squidley V2 with hardened gateway behavior

## Core Commands

```bash
# Run a single test
npm run dev -- run tests/security/gateway-refusal-basic.json

# Run a test suite
npm run dev -- suite security
npm run dev -- suite reliability
npm run dev -- suite architecture
npm run dev -- suite all

# List available tests
npm run dev -- list
npm run dev -- list security

# View reports
npm run dev -- report latest
npm run dev -- report summary
```

## Learning Module — The Lost City of Atlantis

Krakzen includes an optional learning module with two modes:

**Realm Mode** — Navigate the Lost City of Atlantis, face mythical creatures that embody security threats, and earn XP by demonstrating real security knowledge.

**Linear Curriculum** — Structured Security+ aligned modules. Concept, explanation, quiz, feedback loop.

```bash
# Realm
npm run dev -- realm status
npm run dev -- realm zone gates-of-poseidon

# Curriculum
npm run dev -- learn
npm run dev -- learn curriculum-001
```

The learning module is a removable plugin with zero dependency on the core test engine.

### Creature/Concept Mapping

| Creature | Security Concept |
|----------|-----------------|
| Sentinel Golem | Firewalls |
| Mimic | Prompt Injection |
| Shadow Wraith | Data Exfiltration |
| Siren | Social Engineering |
| Hydra | DDoS |
| Leviathan | Final Boss (all concepts) |

## Test Categories

- **security/** — gateway refusal, injection attempts, instruction hierarchy, debug boundaries
- **reliability/** — malformed input handling, input sanitization
- **architecture/** — receipt integrity, field presence, response metadata

## Architecture

- TypeScript CLI-first
- Deterministic evaluation (no AI judging yet)
- Receipt-aware response parsing
- Retry logic for transient failures
- Structured JSON + Markdown reports with suite summaries
- Provider/model agnostic

## Key Docs

- `docs/architecture/ARCHITECTURE.md` — system architecture
- `docs/journal/` — decision journal
- `config/targets.json` — target configuration
