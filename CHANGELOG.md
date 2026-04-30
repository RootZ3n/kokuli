# Changelog

## 2026-04-30 Public RC hardening

### Release Hygiene
- Repositioned README around defensive AI trust-testing for owned/local/staging systems.
- Added Break Me / Armory public RC documentation covering simulation mode, live localhost/private-lab checks, ownership confirmation, report output, and redaction limits.
- Added ecosystem relationship docs for Colosseum, Crucible, Verum, Aedis, and Squidley Public.
- Added `LICENSE`, `SECURITY.md`, `.env.example`, GitHub issue templates, and screenshot placeholder documentation.
- Added package metadata for Node/npm engine expectations and defensive-security keywords.

### Dependency Audit
- Ran `npm audit fix`.
- Updated vulnerable transitive packages in `package-lock.json`:
  - `axios` to `1.15.2`
  - `follow-redirects` to `1.16.0`
  - `brace-expansion` to `5.0.5`
  - `path-to-regexp` to `8.4.2`
  - `proxy-from-env` to `2.1.0`
- `npm audit --audit-level=moderate` now reports zero known vulnerabilities.

## 2026-04-12 (round 2)

### UI Improvements
- Quick filter chips in registry header: All / Failed / Critical / Stale. Filters hide non-matching rows and category headers, updates the test count to show filtered vs total.
- Compact mode now persists across page reloads via localStorage.
- Sticky mini-summary floats at bottom-right while scrolling through the registry, showing: critical failures, total failures, regressions, and public exposure count. Fades in via IntersectionObserver when the registry card is partially visible.

### New Tests (26 added, 121 total)
- **Streaming/Transport (4 new):** SSE endpoint probe, streaming error leakage check, partial-stream refusal consistency, WebSocket upgrade endpoint probe.
- **Rate Limiting (2 new):** rate-limit error body leakage, retry-after header consistency.
- **Auth Hardening (10 new):** expired JWT token, malformed bearer prefix, duplicate auth headers, token in query string rejection, auth downgrade/fallback, redirect on sessions, CORS preflight on /sessions, CORS origin reflection, credentialed cross-origin misconfig, CORS alias inconsistency.
- **Upload/File Surfaces (3 new):** file upload endpoint discovery, fake content-type mismatch, oversized upload rejection.
- **Redirect/Proxy (3 new):** forwarded header confusion (X-Forwarded-For/Host), proxy double-slash path alias, alternate Host header spoofing.
- **Memory/Persistence (3 new):** stored prompt poisoning, poisoned-note recall, delayed retrieval attack after trust building.
- **Data Exfiltration (1 new):** memory search boundary bypass with broad query.

## 2026-04-12

### UI Refinements
- Added target status strip showing target name, saved/temporary source, path mode, auth header presence, and probe status at a glance.
- Added sticky jump bar for quick navigation across test registry categories with per-category fail counts.
- Added compact row mode toggle for the test registry — collapses detail lines to scan faster.
- De-emphasized stale result rows (dimmed opacity) so FAIL, CRITICAL, and REGRESSION states visually dominate.
- Added row-level emphasis classes: failed rows get a red accent bar, critical rows get a pulsing magenta accent.
- Active report button now highlights when a report is open so the selected mode is obvious.
- Findings table rows for critical/high severity now have a left border accent for faster scanning.
- Added "Learn Security" subtitle to the Atlantis nav link so its purpose is clear at first glance.
- Updated Atlantis section header to describe what it actually is: interactive security training.

### New Tests (33 added, 95 total)
- **Security (3 new):** indirect prompt extraction via debug framing, tool listing coercion, evaluator impersonation.
- **Recon (6 new):** HEAD and OPTIONS probes on /health, alternate endpoint aliases (/api/search, /api/runs, /api/health, /api/receipts).
- **Auth (5 new):** method confusion on search/runs/receipts, malformed bearer token, auth header case variation.
- **Exfil (5 new):** transform-then-reveal via summarization/JSON/compression, chunked multi-turn exfiltration, benign diagnostics metadata leak.
- **Multi-turn (3 new):** delayed jailbreak after trust building, repeated reframing to erode safety, poisoned-recall credential pivot.
- **Fuzzing (3 new):** duplicate JSON keys, deeply nested JSON, wrong primitive types.
- **Reliability (4 new):** malformed Content-Type, bizarre Accept header, multipart form-data junk, gzip encoding mismatch.
- **Architecture (4 new):** receipt schema consistency, correlation ID presence, target snapshot consistency, error response consistency.

## 2026-04-06

- Added first-class saved target configuration with explicit endpoint overrides, auth settings, timestamps, and path-mode control.
- Added deterministic target resolution rules for `explicit_only` and `explicit_plus_defaults`.
- Added backend target CRUD, target resolution, and temporary quick-probe support for one-off unsaved runs.
- Added dashboard target editor controls for new target, edit target, and quick probe flows.
- Captured resolved target configuration snapshots in run metadata and exports without exposing secret token values.
- Added compatibility normalization for legacy preset targets that still used `chatPath`.
- Added logic coverage for target validation, migration, path resolution, temporary targets, and local CRUD persistence.

## 2026-04-06

- Added automatic plain-language and AI-share report artifacts to the latest report bundle:
  - `PLAIN_LANGUAGE_REPORT.md`
  - `AI_SHARE_PACKAGE.md`
- Added dashboard copy actions for plain-language sharing and copy-ready packages for Codex, ChatGPT, and Claude.
- Served `/reports` directly from the web server so dashboard export links now resolve to actual report artifacts.
- Updated run completion UX to signal that reports were refreshed automatically.
- Added deterministic test coverage for the new plain-language and AI-share markdown renderers.

## 2026-04-05

- Standardized operator-facing verdict vocabulary across assessment, findings, comparison, dashboard, and exports.
- Added compact deterministic evidence snapshots for each finding and run artifact.
- Added fix verification workflow states and suppression governance metadata with expiry/rationale warnings.
- Added execution trust signals for coverage and target-variance awareness.
- Added a markdown security review export suitable for engineering or leadership review.
- Improved comparison ergonomics with explicit new, recurring, regressed, resolved, and not-comparable buckets.
- Added a screenshot-friendly review summary panel for demos and README usage.
- Added deterministic target fingerprint capture, comparability warnings, and fingerprint visibility in assessment exports and drilldowns.
- Added evaluator provenance, confidence reasoning, lifecycle states, and consequence-aware remediation framing for findings.
- Added operator summary and lightweight performance metrics rollups for rapid run triage.
- Added append-only assessment integrity chaining with checksum and sequence metadata.
- Added docs for a reproducible demo target evaluation path.
- Added explicit execution-state modeling for tests and suites, including persisted last-run metadata and attempt counts.
- Added deterministic risk summary, readiness gates, and target-level assessment snapshots.
- Added normalized findings model with deduplication, exploitability, impact, recency, and regression tracking.
- Added richer audit artifacts for each run: threat profile, exact request, normalized response, evaluator rules, evidence, remediation guidance, and run timeline.
- Promoted transparency data into first-class evidence for UI and exports.
- Added run comparison output for new, resolved, regressed, and unchanged findings.
- Added polished report bundle outputs:
  - `EXECUTIVE_SUMMARY.md`
  - `TECHNICAL_FINDINGS.md`
  - `EVIDENCE_APPENDIX.md`
  - `EVIDENCE_APPENDIX.json`
  - `REMEDIATION_CHECKLIST.md`
  - `RETEST_COMPARISON.md`
- Updated dashboard terminology to use intentional operator-facing copy instead of ambiguous placeholder states.
- Added unit coverage for findings derivation, gate rollups, verdict logic, and regression classification.
