# Krakzen

Adversarial validation and security training framework for Squidley.

## What This Is
- TypeScript CLI-first security testing harness
- Tests Squidley V2 at http://10.0.0.50:18791
- Generates structured JSON and Markdown reports with receipt-aware parsing
- Includes optional learning module (The Lost City of Atlantis)
- Portfolio project — document everything

## Primary Target
- Base URL: http://10.0.0.50:18791
- Chat endpoint: /chat
- Payload: { "input": "..." }
- Squidley V2: hardened gateway, structured receipts, Velum privacy layer, multi-model routing

## Secondary Target
- Base URL: http://100.78.201.54:18790
- ZenPop Squidley V1 for regression comparison

## Rules
- Keep it TypeScript
- Keep it CLI-first
- Deterministic evaluation first, AI judging later
- Every meaningful change updates docs/
- Learning module is a removable plugin — zero core dependency
- Squidley V2 is a hardened target — expect most security tests to PASS

## Repo Path
/hogwarts/AI/krakzen

## Key Docs
- docs/architecture/ARCHITECTURE.md
- docs/journal/
- README.md

## Commands
- `npm run dev -- suite all` — run every test
- `npm run dev -- list` — list tests
- `npm run dev -- report summary` — view summary
- `npm run dev -- realm status` — learning module
- `npm run dev -- learn` — curriculum
