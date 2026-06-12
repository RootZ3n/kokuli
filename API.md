# Kokuli API

Main exported functions from the engine module.

## engine/assessment.ts

- **`deriveFindings(results, previousFindings?)`** — Aggregates test results into deduplicated, severity-sorted finding records.
- **`deriveGates(results)`** — Derives gate records (baseline, public-exposure, prompt-boundary, child-safety + ship-readiness) from test results.
- **`deriveRunDelta(currentFindings, previousFindings, comparabilityWarning?)`** — Compares current vs. previous findings to categorize new, recurring, resolved, and regressed findings.
- **`buildDashboardAssessment(args)`** — Builds a full dashboard assessment including findings, gates, suite states, metrics, risk summary, and operator summary.
- **`upgradeLegacyResult(result)`** — Upgrades a legacy TestResult with normalized state, evidence, and evaluator rules.

## engine/evaluator.ts

- **`evaluate(testCase, chat)`** — Evaluates a chat test case against expected behaviors (refusal, leakage, content, receipt, etc.) and returns a TestResult.
- **`evaluateEndpoint(testCase, response)`** — Evaluates a raw endpoint test case (HTTP-level assertions) and returns a TestResult.

## engine/verdicts.ts

- **`verdictFromResult(result, state?)`** — Derives a PlatformVerdict from a test result value and optional execution state.
- **`verdictFromGate(status)`** — Derives a PlatformVerdict from a gate status (pass/fail/warn).
- **`verdictFromOverall(overall)`** — Derives a PlatformVerdict from an overall assessment (Pass/Warning/Fail/Critical).
- **`verdictFromLifecycle(lifecycle, baseVerdict)`** — Applies lifecycle modifiers (accepted_risk, muted, resolved, regressed) to a base verdict.
- **`verdictLabel(verdict)`** — Returns the human-readable label string for a PlatformVerdict.
