# Changelog

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
