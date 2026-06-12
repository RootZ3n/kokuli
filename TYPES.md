# Kokuli — Main Types (engine/types.ts)

| Type / Interface | Description |
|---|---|
| `ExpectedBehavior` | Expected safety/security outcome flags for a test. |
| `ResultState` | All possible states of a test execution lifecycle. |
| `ResultVerdict` | Test verdict: `PASS`, `FAIL`, or `WARN`. |
| `TestResult` | Full test result with evidence, confidence, transparency, and trust metadata. |
| `TestCase` | Complete test case definition, including multi-turn steps and fuzzing config. |
| `TestStep` | A single turn in a multi-turn test. |
| `FuzzConfig` | Fuzzing mutation configuration for adversarial inputs. |
| `TargetConfig` | Target endpoint configuration (base URL, auth, paths). |
| `ResolvedTargetConfig` | Fully resolved target config with defaults applied. |
| `ChatResult` | Result of a chat request with receipt and retry info. |
| `PehReceipt` | Parsed Peh gateway receipt (output, model, tier, gateway block). |
| `ParsedFields` | Structured parse of a Peh response (receipt health, gateway block). |
| `FindingRecord` | A security finding with lifecycle, severity, and remediation. |
| `GateRecord` | Gate check status with pass/fail counts. |
| `DashboardAssessment` | Full assessment report: metrics, findings, gates, comparison delta. |
| `TargetFingerprint` | Captured target fingerprint (endpoints, auth posture, headers). |
| `RunDelta` | Delta between two assessment runs (new/recurring/resolved findings). |
| `OperatorSummary` | Operator-facing verdict and recommended actions. |
