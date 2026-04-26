# Verum

Adversarial validation and security training framework for Squidley.

## What This Is
- TypeScript CLI-first security testing harness
- Tests Squidley V2 at http://10.0.0.50:18791
- Generates structured JSON and Markdown reports with receipt-aware parsing
- Includes optional learning module (The Lost City of Atlantis)
- Web UI companion (dashboard + Atlantis portal)
- Portfolio project — document everything

## Primary Target
- Base URL: http://10.0.0.50:18791
- Chat endpoint: /chat
- Payload: { "messages": [{ "role": "user", "content": "..." }] }
- Squidley V2: hardened gateway, structured receipts, Velum privacy layer, multi-model routing

## Lab
- Mushin: i7-13700K, RTX 4070, Debian 12 — Squidley V2 host
- Pop Tart: AMD RX 6800, 32GB DDR5, Pop!_OS — Verum host, compute/red team
- ZenPop: retired, replaced by Mushin

## Rules
- Keep it TypeScript
- Keep it CLI-first
- Deterministic evaluation first, AI judging later
- Every meaningful change updates docs/
- Learning module is a removable plugin — zero core dependency
- Squidley V2 is a hardened target — expect most security tests to PASS

## Repo Path
/hogwarts/AI/verum

## Key Docs
- docs/architecture/ARCHITECTURE.md
- docs/setup/LAB_WORKFLOW.md
- docs/journal/
- README.md

## Commands
- `npm run dev -- suite all` — run every test
- `npm run dev -- run <test-id>` — run single test by ID
- `npm run dev -- list` — list tests
- `npm run dev -- report summary` — view summary
- `npm run web` — start web UI on port 3000
- `npm run dev -- realm status` — learning module
- `npm run dev -- learn` — curriculum
