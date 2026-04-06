# Changelog

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
