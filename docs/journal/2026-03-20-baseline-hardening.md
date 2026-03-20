# 2026-03-20 Baseline Hardening Session

## What happened

Took Krakzen from "working baseline" to "credible baseline framework." Major improvements across the core engine, reporting, CLI, and a new learning module.

## Target update

Primary target changed from ZenPop Squidley V1 to Mushin Squidley V2.

- Mushin V2: `http://10.0.0.50:18791` — hardened gateway, structured receipts, Velum privacy layer, multi-model routing
- ZenPop V1: `http://100.78.201.54:18790` — retained as secondary regression target

All test definitions updated to reference `mushin-squidley-v2`.

## Key changes

### Receipt-aware response parsing

Krakzen now parses structured Squidley JSON responses and explicitly inspects fields:
- output, receipt_id, provider, model, active_model
- tier, escalated, context.used, memory_hits
- error, reason (gateway blocks)

The `ChatResult` type now carries a `SquidleyReceipt` object alongside raw text. The evaluator uses parsed fields for structured inspection rather than relying solely on text matching.

### Retry logic

Added retry-once policy for transient failures (timeouts, connection resets, 502/503/504). Retries are logged with original error preserved. Evidence appears in both CLI output and reports.

### Improved reporting

Reports now include:
- Test metadata (category, purpose, duration)
- Parsed response field table
- Retry information
- Suite summary (SUMMARY.md + SUMMARY.json) after suite runs

### New baseline tests

Added 4 new tests (9 total):
- **receipt-field-presence** — verifies structured receipt metadata on benign requests
- **soft-injection-phrasing** — subtler, conversational injection attempt
- **benign-debug-boundary** — maps the boundary between helpful info and restricted details
- **input-sanitization-variant** — mixed encoding, HTML entities, control sequences

### CLI improvements

- `list [category]` — list available tests with descriptions
- `suite all` — run every test across all categories
- `report summary` — show latest suite summary
- Colored summary table after suite runs
- Better help text

### Learning module — The Lost City of Atlantis

New removable plugin with two modes:

**Realm** — Gamified security training set in the Lost City of Atlantis. Navigate zones, encounter creatures that embody security concepts (Mimic=prompt injection, Siren=social engineering, Hydra=DDoS, etc.), answer quizzes to defeat them, earn XP and level up.

**Linear Curriculum** — Structured Security+ aligned modules with concept → explanation → quiz → feedback.

Architecture rule: zero dependency on core. The entire learning/ directory can be deleted and Krakzen core still runs.

## Decisions

- Kept deterministic evaluation only. AI judge layer deferred.
- Learning module is a plugin, not core. Separation of concerns for portfolio.
- Retry policy is conservative (once only). Avoids masking real failures.
- Squidley V2 is assumed to be a significantly hardened target. Tests designed accordingly.

## What to run next

```bash
npm run dev -- suite all
npm run dev -- realm status
npm run dev -- learn
```

## Test inventory

| ID | Name | Category |
|----|------|----------|
| baseline-001 | Baseline Chat Availability | security |
| security-001 | Gateway Refusal Basic | security |
| security-002 | Instruction Hierarchy Basic | security |
| security-003 | Soft Injection Phrasing | security |
| security-004 | Benign Debug Boundary | security |
| reliability-001 | Malformed Input Basic | reliability |
| reliability-002 | Input Sanitization Variant | reliability |
| architecture-001 | Receipt Integrity Basic | architecture |
| architecture-002 | Receipt Field Presence | architecture |
