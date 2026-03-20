# Krakzen Architecture

## Machines

### Mushin
- Primary Squidley V2 host
- Hardened gateway, structured receipts, Velum privacy layer, multi-model routing
- Primary test target for Krakzen

### Zen Pop
- Pop!_OS
- Original Squidley V1 build
- Secondary target for regression comparison

### Pop Tart
- Pop!_OS
- Krakzen host
- Stores reports, documentation, and release-gate logic

## Network

All communication happens over Tailscale.

- Primary target: `http://10.0.0.50:18791/chat`
- Secondary target: `http://100.78.201.54:18790/chat`
- Payload shape: `{ "input": "..." }`

## Krakzen Core

### Engine Components

- **cli.ts** — CLI entry point, command routing, suite runner with summary output
- **client.ts** — HTTP client with receipt parsing and retry-once logic for transient failures
- **evaluator.ts** — Deterministic rule-based evaluation with receipt-aware field inspection
- **loaders.ts** — Test and target config loaders
- **reportWriter.ts** — JSON + Markdown report generation with parsed field tables and suite summaries
- **types.ts** — Shared type definitions including SquidleyReceipt, ParsedFields, RetryInfo

### Receipt Awareness

Krakzen parses structured Squidley responses and explicitly inspects:
- `output` — chat response content
- `receipt_id` — unique request receipt
- `provider` / `model` / `active_model` — routing metadata
- `tier` — model tier
- `escalated` — whether request was escalated
- `context.used` — whether context was applied
- `memory_hits` — memory retrieval results
- `error` / `reason` — gateway block details

### Retry Policy

- Retry once on transient failure (timeout, connection reset, 502/503/504)
- Log the retry with original error
- Preserve retry evidence in reports

### Evaluation Rules

Tests are evaluated deterministically:
- Gateway blocks (HTTP 400 with security reason codes) = PASS for refusal tests
- Receipt field presence checks for architecture tests
- System prompt leak detection
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
2. **Linear Curriculum** — Structured Security+ aligned modules. No fiction, just concept → explanation → quiz → feedback.

### CLI Integration

The learning module registers `realm` and `learn` as commands in the main CLI. If the learning module were removed, these commands would simply not exist.

## Long-Term Direction

### Krakzen Core
- Deeper adversarial validation
- Regression framework
- Release gate workflow (Mushin → Pop Tart)
- Multimodal endpoint testing
- Optional AI judge layer

### Learning Module
- More zones, creatures, and curriculum modules
- XP-gated access to advanced Krakzen features
- Network security training modules
- VM lab guidance integration
