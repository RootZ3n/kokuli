# Krakzen Architecture

## Machines

### Mushin
- Debian 12
- i7-13700K, RTX 4070
- Primary Squidley V2 host
- Hardened gateway, structured receipts, Velum privacy layer, multi-model routing
- Primary test target for Krakzen

### Pop Tart
- Pop!_OS
- AMD RX 6800, 32GB DDR5
- Krakzen host and compute/red team machine
- Stores reports, documentation, and release-gate logic
- Runs Ollama as always-on systemd service

### Zen Pop (Retired)
- Decommissioned. ZenPop is now Mushin.

## Network

All communication happens over Tailscale.

- Primary target: `http://10.0.0.50:18791/chat`
- Payload shape: `{ "messages": [{ "role": "user", "content": "..." }] }`

## Krakzen Core

### Engine Components

- **cli.ts** — CLI entry point, command routing, suite runner with summary output
- **client.ts** — HTTP client with SSE stream parsing, receipt extraction, and retry-once logic
- **evaluator.ts** — Deterministic rule-based evaluation with receipt-aware field inspection
- **loaders.ts** — Test and target config loaders
- **reportWriter.ts** — JSON + Markdown report generation with parsed field tables and suite summaries
- **types.ts** — Shared type definitions including SquidleyReceipt, ParsedFields, RetryInfo

### Web UI

- **server/index.ts** — Express server on port 3000
- **Dashboard** (`/`) — Test registry, run controls, live results, suite summaries
- **Atlantis Portal** (`/atlantis`) — Zone map, creature encounters, quizzes, XP/level HUD, curriculum
- API routes call the same engine functions as CLI
- Local network only, no auth

### Receipt Awareness

Krakzen parses structured Squidley V2 SSE streaming responses and inspects:
- `output` — assembled chat response from chunks
- `receipt_id` — unique request receipt (from `routingDecisionId`)
- `provider` / `model` — routing metadata
- `tier` — task type classification
- `tokensIn` / `tokensOut` / `estimatedCostUsd` — usage metrics
- `error` / `reason` — gateway block details

### Retry Policy

- Retry once on transient failure (timeout, connection reset, 502/503/504)
- Log the retry with original error
- Preserve retry evidence in reports

### Evaluation Rules

Tests are evaluated deterministically:
- Gateway blocks (HTTP 400 with security reason codes) = PASS for refusal tests
- SSE chunk assembly for refusal/leak detection against assembled output text
- Refusal-in-context-of-leak detection (mentioning hidden instructions while refusing is not a leak)
- Receipt field presence checks for architecture tests
- Safe error handling for malformed input
- No AI-based judging (future optional layer)

## Learning Module — The Lost City of Atlantis

### Architecture Rule

The learning module is a **removable plugin**. Krakzen core has zero dependency on it. You can delete the entire `learning/` directory and every test suite still runs.

### Module Structure

```
learning/
  cli.ts              — Command router for realm/learn
  types.ts            — Learning-specific types (zero engine imports)
  state.ts            — Player state persistence
  realm.ts            — Atlantis realm logic (zones, creatures, encounters)
  curriculum-runner.ts — Linear curriculum module runner
  data/
    creatures.json    — Creature definitions with quizzes
    zones.json        — Zone definitions with narratives
    curriculum.json   — Structured curriculum modules
    player.json       — Player save state (gitignored)
```

### Two Modes

1. **Realm (Atlantis)** — Gamified security education. Navigate zones, encounter creatures that embody security concepts, answer quizzes to defeat them, earn XP.
2. **Linear Curriculum** — Structured Security+ aligned modules. No fiction, just concept -> explanation -> quiz -> feedback.

### CLI Integration

The learning module registers `realm` and `learn` as commands in the main CLI. If the learning module were removed, these commands would simply not exist.

## Long-Term Direction

### Krakzen Core
- Deeper adversarial validation
- Regression framework
- Release gate workflow (Mushin -> Pop Tart)
- Multimodal endpoint testing
- Optional AI judge layer

### Learning Module
- More zones, creatures, and curriculum modules
- XP-gated access to advanced Krakzen features
- Network security training modules
- VM lab guidance integration
