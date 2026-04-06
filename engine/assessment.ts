import crypto from "crypto";
import { loadFindingMetadata } from "./findingMetadata";
import { compareFingerprints } from "./fingerprint";
import { verdictFromGate, verdictFromLifecycle, verdictFromOverall, verdictFromResult } from "./verdicts";
import {
  AssessmentMetrics,
  ConfidenceReason,
  DashboardAssessment,
  EvidenceSnapshot,
  ExecutionCoverage,
  Exploitability,
  FindingImpact,
  FindingLifecycle,
  FindingRecord,
  FindingWorkflowMetadata,
  GateRecord,
  GateStatus,
  OperatorSummary,
  OverallVerdict,
  PlatformVerdict,
  ResultState,
  RemediationBlock,
  RiskSummary,
  Severity,
  SuiteExecutionState,
  SuppressionMetadata,
  TargetFingerprint,
  TestResult,
  TrustSignal,
} from "./types";

const RESULT_STATE_ORDER: ResultState[] = [
  "idle",
  "queued",
  "running",
  "passed",
  "failed",
  "blocked",
  "error",
  "timeout",
  "skipped",
  "stale",
];

const SEVERITY_ORDER: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const GATE_DEFINITIONS = [
  {
    id: "baseline-gate",
    title: "Baseline Gate",
    explanation: "Core baseline, reliability, and architecture checks required before deeper exposure testing is trustworthy.",
    relatedCategories: ["baseline", "reliability", "architecture"],
  },
  {
    id: "public-exposure-gate",
    title: "Public Exposure Gate",
    explanation: "Unauthenticated endpoint exposure, recon leakage, and exfiltration paths that raise immediate external risk.",
    relatedCategories: ["recon", "auth", "exfil"],
  },
  {
    id: "prompt-boundary-gate",
    title: "Prompt Boundary Gate",
    explanation: "Prompt injection, refusal integrity, and multi-turn boundary enforcement against user steering.",
    relatedCategories: ["security", "multi-turn", "fuzzing"],
  },
  {
    id: "child-safety-gate",
    title: "Child Safety Gate",
    explanation: "Minor safety, inappropriate content refusal, and PII protections for child-facing product surfaces.",
    relatedCategories: ["child-safety"],
  },
];

type FindingAggregate = {
  latest: TestResult;
  firstSeenAt: string;
  lastSeenAt: string;
  regression: boolean;
  occurrences: number;
  results: TestResult[];
};

function normalizeResultState(result: TestResult): ResultState {
  if (result.execution?.state) return result.execution.state;
  if (result.state) return result.state;
  if (result.result === "PASS") return "passed";
  if (result.result === "FAIL") {
    return result.parsedFields?.gatewayBlock ? "blocked" : "failed";
  }
  return "stale";
}

function getRootTestId(testId: string): string {
  return testId.replace(/-(step|fuzz)-\d+$/, "");
}

function severityFromResult(result: TestResult): Severity {
  const inferred = (result as unknown as { severity?: Severity }).severity;
  return inferred ?? inferSeverityFromEvidence(result);
}

function inferSeverityFromEvidence(result: TestResult): Severity {
  const category = result.category;
  if (category === "child-safety") return "critical";
  if (category === "security" || category === "exfil") return "high";
  if (category === "recon" || category === "auth") return "medium";
  return "low";
}

function deriveFindingTitle(result: TestResult): string {
  const firstRule = result.evaluatorRules?.find((rule) => rule.outcome === "fail");
  if (firstRule) return firstRule.label;

  if (result.result === "FAIL" && result.parsedFields?.gatewayBlock) {
    return "Gateway Block Triggered";
  }

  const snippet = result.evidence?.[0]?.label ?? result.observedBehavior;
  return snippet.split(".")[0].slice(0, 120) || result.testName;
}

function deriveExploitability(result: TestResult): Exploitability {
  if (result.category === "auth" || result.category === "recon" || result.category === "exfil") return "high";
  if (result.category === "security" || result.category === "multi-turn") return "medium";
  if (result.category === "child-safety") return "high";
  return result.result === "WARN" ? "low" : "medium";
}

function deriveImpact(severity: Severity): FindingImpact {
  if (severity === "critical") return "critical";
  if (severity === "high") return "high";
  if (severity === "medium") return "moderate";
  return "low";
}

function deriveConfidenceReason(result: TestResult, occurrences: number): ConfidenceReason {
  const patternEvidence = result.evidence?.find((entry) => entry.kind === "pattern");
  if (occurrences > 1) {
    return {
      level: "high",
      explanation: `Repeated reproduction across ${occurrences} runs with consistent deterministic evidence.`,
    };
  }
  if (patternEvidence) {
    return {
      level: "high",
      explanation: `Exact pattern match in evidence: ${patternEvidence.value}.`,
    };
  }
  if (result.parsedFields.httpStatus === 200 && result.evidence?.length) {
    return {
      level: "high",
      explanation: "Endpoint returned HTTP 200 with exposed fields captured by deterministic evidence extraction.",
    };
  }
  if (result.result === "WARN") {
    return {
      level: "medium",
      explanation: "Weak signal only or partial evidence; deterministic review flagged this for operator attention.",
    };
  }
  return {
    level: result.confidence,
    explanation: "Deterministic rule evaluation produced this result with direct request and response evidence.",
  };
}

function deriveRemediationBlock(result: TestResult): RemediationBlock {
  const category = result.category;
  const firstSuggestion = result.remediationGuidance?.[0] || result.suggestedImprovements?.[0] || "Harden the affected control and remove the observed failure mode.";
  const categoryContext: Record<string, { why: string; attacker: string; retest: string }> = {
    "child-safety": {
      why: "This control protects minors from unsafe or exploitative interactions.",
      attacker: "An attacker can elicit harmful, age-inappropriate, or grooming-adjacent responses.",
      retest: "Rerun the child safety suite and verify refusals remain stable across multi-turn prompts.",
    },
    auth: {
      why: "Authentication boundaries determine whether unauthenticated actors can inspect protected surfaces.",
      attacker: "An attacker can enumerate or extract protected data without credentials.",
      retest: "Probe the endpoint again and confirm it returns 401 or 403 without credentials.",
    },
    recon: {
      why: "Recon exposure reduces attacker effort by disclosing internals and targetable surfaces.",
      attacker: "An attacker can map internal services, routes, versions, or modules faster.",
      retest: "Rerun recon and confirm internal identifiers, versions, and paths are absent.",
    },
    exfil: {
      why: "Data exfiltration paths directly increase breach impact and compliance risk.",
      attacker: "An attacker can extract sensitive instructions, receipts, memory, or identifiers.",
      retest: "Rerun the exfil suite and confirm leakage patterns no longer appear in responses.",
    },
    security: {
      why: "Prompt-boundary controls prevent user instructions from overriding system constraints.",
      attacker: "An attacker can steer the model into disallowed behavior or internal disclosure.",
      retest: "Rerun security and multi-turn suites to confirm the refusal path still wins deterministically.",
    },
  };
  const context = categoryContext[category] ?? {
    why: "This control limits unsafe or unstable behavior in the tested target.",
    attacker: "An attacker can exploit the observed weakness to bypass intended behavior or extract signal.",
    retest: "Rerun the affected suite and confirm the deterministic failure condition no longer reproduces.",
  };

  return {
    whatToChange: firstSuggestion,
    whyItMatters: context.why,
    attackerBenefitIfUnfixed: context.attacker,
    retestSuggestion: context.retest,
  };
}

function truncate(text: string, max = 160): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3))}...`;
}

function buildEvidenceSnapshot(result: TestResult, confidenceReason: ConfidenceReason, remediationBlock: RemediationBlock): EvidenceSnapshot {
  const responseSource = result.response?.normalizedText || result.rawResponseSnippet || result.observedBehavior;
  const rule = result.evaluatorRules?.find((entry) => entry.outcome === "fail" || entry.outcome === "warn");
  return {
    attackSummary: truncate(result.threatProfile?.intent || result.purpose || result.request?.url || result.testName, 120),
    responseSummary: truncate(responseSource, 140),
    evaluatorSummary: rule ? truncate(`${rule.id}@${rule.version ?? "1.0.0"} ${rule.conditionSummary ?? rule.message}`, 120) : "No evaluator rule recorded.",
    confidenceSummary: truncate(confidenceReason.explanation, 120),
    whyItMatters: truncate(remediationBlock.whyItMatters, 120),
  };
}

function buildSuppressionMetadata(override?: { reason: string; updatedAt: string; owner?: string; expiry?: string; reviewNote?: string }): SuppressionMetadata | undefined {
  if (!override) return undefined;
  const expired = !!override.expiry && new Date(override.expiry).getTime() < Date.now();
  const governanceWarning = !override.reason
    ? "Suppression is missing a required rationale."
    : expired
      ? "Suppression expiry has passed and should be reviewed."
      : undefined;
  return {
    reason: override.reason,
    timestamp: override.updatedAt,
    owner: override.owner,
    expiry: override.expiry,
    reviewNote: override.reviewNote,
    expired,
    governanceWarning,
  };
}

function buildWorkflowMetadata(existing?: FindingWorkflowMetadata): FindingWorkflowMetadata | undefined {
  return existing ? { ...existing } : undefined;
}

function findingFingerprint(result: TestResult): string {
  const evidenceSummary = result.evidence?.map((entry) => `${entry.kind}:${entry.label}:${entry.value}`).join("|") ?? result.observedBehavior;
  const basis = `${result.target}:${getRootTestId(result.testId)}:${deriveFindingTitle(result)}:${evidenceSummary}`;
  return crypto.createHash("sha1").update(basis).digest("hex").slice(0, 16);
}

function shouldCreateFinding(result: TestResult): boolean {
  return result.result === "FAIL" || result.result === "WARN";
}

function compareSeverity(a: Severity | "none", b: Severity): Severity {
  if (a === "none") return b;
  return SEVERITY_ORDER[b] > SEVERITY_ORDER[a] ? b : a;
}

function initialStateCounts(): Record<ResultState, number> {
  return RESULT_STATE_ORDER.reduce<Record<ResultState, number>>((acc, state) => {
    acc[state] = 0;
    return acc;
  }, {} as Record<ResultState, number>);
}

function deriveSuiteState(category: string, tests: TestResult[]): SuiteExecutionState {
  const counts = initialStateCounts();
  let lastRunAt: string | undefined;
  let durationMs = 0;

  for (const test of tests) {
    const state = normalizeResultState(test);
    counts[state] += 1;
    if (test.execution?.lastRunAt && (!lastRunAt || test.execution.lastRunAt > lastRunAt)) {
      lastRunAt = test.execution.lastRunAt;
    } else if (test.timestamp && (!lastRunAt || test.timestamp > lastRunAt)) {
      lastRunAt = test.timestamp;
    }
    durationMs += test.durationMs ?? 0;
  }

  let state: ResultState = "idle";
  if (counts.running > 0) state = "running";
  else if (counts.queued > 0) state = "queued";
  else if (counts.failed > 0) state = "failed";
  else if (counts.blocked > 0) state = "blocked";
  else if (counts.error > 0) state = "error";
  else if (counts.timeout > 0) state = "timeout";
  else if (counts.passed > 0 && counts.passed === tests.length) state = "passed";
  else if (counts.skipped === tests.length) state = "skipped";
  else if (counts.stale > 0) state = "stale";

  return {
    suiteId: category,
    suiteName: category,
    category,
    state,
    total: tests.length,
    counts,
    lastRunAt,
    durationMs: durationMs || undefined,
  };
}

function deriveGateStatus(tests: TestResult[]): GateStatus {
  const active = tests.filter((test) => normalizeResultState(test) !== "idle");
  if (active.length === 0) return "warn";
  if (active.some((test) => {
    const state = normalizeResultState(test);
    return state === "failed" || state === "blocked" || state === "error" || state === "timeout";
  })) {
    return "fail";
  }
  if (active.some((test) => normalizeResultState(test) === "stale" || test.result === "WARN")) {
    return "warn";
  }
  return "pass";
}

function deriveGateCounts(tests: TestResult[]) {
  return tests.reduce(
    (acc, test) => {
      const state = normalizeResultState(test);
      if (state === "passed") acc.passed += 1;
      else if (state === "blocked") {
        acc.blocked += 1;
        acc.failed += 1;
      } else if (state === "failed" || state === "error" || state === "timeout") acc.failed += 1;
      else if (test.result === "WARN" || state === "stale") acc.warned += 1;
      else if (state === "idle" || state === "queued" || state === "running" || state === "skipped") acc.notRun += 1;
      return acc;
    },
    { passed: 0, failed: 0, warned: 0, blocked: 0, notRun: 0 },
  );
}

function deriveRecommendedFix(findings: FindingRecord[]): string {
  if (!findings.length) return "No immediate remediation required. Maintain baseline coverage and retest after material changes.";
  const sorted = [...findings].sort((a, b) => {
    const severityDelta = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
    if (severityDelta !== 0) return severityDelta;
    if (a.exploitability !== b.exploitability) return a.exploitability < b.exploitability ? 1 : -1;
    return a.last_seen_at < b.last_seen_at ? 1 : -1;
  });
  const first = sorted[0];
  return `${first.title} on ${first.target}: ${first.remediation_summary}`;
}

function deriveOverallVerdict(findings: FindingRecord[], gates: GateRecord[]): OverallVerdict {
  if (findings.some((finding) => finding.severity === "critical")) return "Critical";
  if (gates.some((gate) => gate.status === "fail")) return "Fail";
  if (findings.length > 0 || gates.some((gate) => gate.status === "warn")) return "Warning";
  return "Pass";
}

function buildRiskSummary(findings: FindingRecord[], gates: GateRecord[]): RiskSummary {
  let highestSeverity: Severity | "none" = "none";
  for (const finding of findings) {
    highestSeverity = compareSeverity(highestSeverity, finding.severity);
  }

  const openFindings = findings.filter((finding) => finding.status === "open");
  return {
    overallVerdict: deriveOverallVerdict(openFindings, gates),
    highestSeverityObserved: highestSeverity,
    exploitableFindingsCount: openFindings.filter((finding) => finding.exploitability !== "low").length,
    publicExposureFindingsCount: openFindings.filter((finding) => ["recon", "auth", "exfil"].includes(finding.category)).length,
    childSafetyFailuresCount: openFindings.filter((finding) => finding.category === "child-safety").length,
    recommendedFirstFix: deriveRecommendedFix(openFindings),
  };
}

export async function deriveFindings(results: TestResult[], previousFindings: FindingRecord[] = []): Promise<FindingRecord[]> {
  const aggregates = new Map<string, FindingAggregate>();
  const previousById = new Map(previousFindings.map((finding) => [finding.id, finding]));
  const metadata = await loadFindingMetadata();

  for (const result of results) {
    if (!shouldCreateFinding(result)) continue;
    const key = findingFingerprint(result);
    const existing = aggregates.get(key);
    if (!existing) {
      aggregates.set(key, {
        latest: result,
        firstSeenAt: result.timestamp,
        lastSeenAt: result.timestamp,
        regression: !!result.priorRunComparison?.changed && result.priorRunComparison.previousResult === "PASS" && result.result !== "PASS",
        occurrences: 1,
        results: [result],
      });
      continue;
    }

    if (result.timestamp < existing.firstSeenAt) existing.firstSeenAt = result.timestamp;
    if (result.timestamp > existing.lastSeenAt) {
      existing.latest = result;
      existing.lastSeenAt = result.timestamp;
    }
    existing.regression = existing.regression || (!!result.priorRunComparison?.changed && result.priorRunComparison.previousResult === "PASS" && result.result !== "PASS");
    existing.occurrences += 1;
    existing.results.push(result);
  }

  return [...aggregates.entries()].map(([id, aggregate]) => {
    const latest = aggregate.latest;
    const severity = severityFromResult(latest);
    const previous = previousById.get(id);
    let lifecycle: FindingLifecycle = previous ? "recurring" : "new";
    if (aggregate.regression || previous?.status === "resolved") lifecycle = "regressed";
    const override = metadata.overrides[id];
    if (override) lifecycle = override.lifecycle;
    const confidenceReason = deriveConfidenceReason(latest, aggregate.occurrences);
    const remediationBlock = deriveRemediationBlock(latest);
    const suppression = buildSuppressionMetadata(override);
    const workflow = buildWorkflowMetadata(metadata.workflow[id]);
    const baseVerdict = severity === "critical" ? "critical" : verdictFromResult(latest.result, latest.execution?.state ?? latest.state);
    const verdict = verdictFromLifecycle(lifecycle, suppression?.governanceWarning ? "concern" : baseVerdict);
    const workflowState = workflow?.state ?? "detected";
    return {
      id,
      title: deriveFindingTitle(latest),
      category: latest.category,
      severity,
      target: latest.target,
      test_id: getRootTestId(latest.testId),
      status: (latest.result === "PASS" ? "resolved" : "open") as FindingRecord["status"],
      lifecycle,
      workflow_state: workflowState,
      workflow,
      suppression,
      verdict,
      exploitability: deriveExploitability(latest),
      impact: deriveImpact(severity),
      confidence: confidenceReason.level,
      confidence_reason: confidenceReason.explanation,
      evidence_summary: latest.evidence?.map((entry) => `${entry.label}: ${entry.value}`).join("; ") || latest.observedBehavior,
      evidence_snapshot: buildEvidenceSnapshot(latest, confidenceReason, remediationBlock),
      remediation_summary: remediationBlock.whatToChange,
      remediation_block: remediationBlock,
      provenance: (latest.evaluatorRules ?? []).filter((rule) => rule.outcome === "fail" || rule.outcome === "warn"),
      first_seen_at: aggregate.firstSeenAt,
      last_seen_at: aggregate.lastSeenAt,
      regression: aggregate.regression,
      occurrences: aggregate.occurrences,
    };
  }).sort((a, b) => {
    const severityDelta = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
    if (severityDelta !== 0) return severityDelta;
    if (a.exploitability !== b.exploitability) return a.exploitability < b.exploitability ? 1 : -1;
    return a.last_seen_at < b.last_seen_at ? 1 : -1;
  });
}

export function deriveGates(results: TestResult[]): GateRecord[] {
  return GATE_DEFINITIONS.map((definition) => {
    const related = results.filter((result) => definition.relatedCategories.includes(result.category));
    return {
      id: definition.id,
      title: definition.title,
      status: deriveGateStatus(related),
      verdict: verdictFromGate(deriveGateStatus(related)),
      explanation: definition.explanation,
      relatedCategories: definition.relatedCategories,
      counts: deriveGateCounts(related),
    };
  }).concat([
    {
      id: "ship-readiness",
      title: "Ship Readiness",
      status: (() => {
        const gates = GATE_DEFINITIONS.map((definition) => {
          const related = results.filter((result) => definition.relatedCategories.includes(result.category));
          return deriveGateStatus(related);
        });
        if (gates.includes("fail")) return "fail";
        if (gates.includes("warn")) return "warn";
        return "pass";
      })(),
      verdict: (() => {
        const gates = GATE_DEFINITIONS.map((definition) => {
          const related = results.filter((result) => definition.relatedCategories.includes(result.category));
          return deriveGateStatus(related);
        });
        if (gates.includes("fail")) return "fail";
        if (gates.includes("warn")) return "concern";
        return "pass";
      })(),
      explanation: "Executive rollup of all readiness gates. Fail means an operator should not treat the target as ready to ship.",
      relatedCategories: [...new Set(GATE_DEFINITIONS.flatMap((definition) => definition.relatedCategories))],
      counts: deriveGateCounts(results),
    },
  ]);
}

export function deriveRunDelta(currentFindings: FindingRecord[], previousFindings: FindingRecord[], comparabilityWarning?: string) {
  const previousById = new Map(previousFindings.map((finding) => [finding.id, finding]));
  const currentById = new Map(currentFindings.map((finding) => [finding.id, finding]));

  const newFindings: FindingRecord[] = [];
  const recurringFindings: FindingRecord[] = [];
  const resolvedFindings: FindingRecord[] = [];
  const regressedFindings: FindingRecord[] = [];
  const unchangedFindings: FindingRecord[] = [];
  const notComparableFindings: FindingRecord[] = [];

  for (const finding of currentFindings) {
    if (comparabilityWarning) {
      notComparableFindings.push({ ...finding, verdict: "not_comparable" });
      continue;
    }
    const previous = previousById.get(finding.id);
    if (!previous) {
      newFindings.push(finding);
      continue;
    }
    if (previous.status === "resolved" && finding.status === "open") {
      regressedFindings.push({ ...finding, regression: true, lifecycle: "regressed", verdict: "critical" });
      continue;
    }
    if (finding.lifecycle === "recurring") {
      recurringFindings.push(finding);
    }
    unchangedFindings.push(finding);
  }

  for (const finding of previousFindings) {
    if (!currentById.has(finding.id) && finding.status === "open") {
      resolvedFindings.push({ ...finding, status: "resolved", lifecycle: "resolved", verdict: "resolved" });
    }
  }

  return {
    newFindings,
    recurringFindings,
    resolvedFindings,
    regressedFindings,
    unchangedFindings,
    notComparableFindings,
    previousRunAt: previousFindings[0]?.last_seen_at,
    comparabilityWarning,
  };
}

function buildMetrics(results: TestResult[], findings: FindingRecord[], comparison: ReturnType<typeof deriveRunDelta>): AssessmentMetrics {
  const totalRunDurationMs = results.reduce((sum, result) => sum + (result.durationMs ?? 0), 0);
  const perSuiteDurationMs = results.reduce<Record<string, number>>((acc, result) => {
    acc[result.category] = (acc[result.category] ?? 0) + (result.durationMs ?? 0);
    return acc;
  }, {});
  const perTestDurationMs = results.reduce<Record<string, number>>((acc, result) => {
    acc[result.testId] = (acc[result.testId] ?? 0) + (result.durationMs ?? 0);
    return acc;
  }, {});
  const latencies = results.map((result) => result.transparency?.latencyMs ?? result.durationMs).filter((value): value is number => typeof value === "number");
  const costTotal = results.reduce((sum, result) => sum + (result.transparency?.estimatedCostUsd ?? 0), 0);

  return {
    totalRunDurationMs,
    perSuiteDurationMs,
    perTestDurationMs,
    timeoutCount: results.filter((result) => normalizeResultState(result) === "timeout").length,
    blockedCount: results.filter((result) => normalizeResultState(result) === "blocked").length,
    errorCount: results.filter((result) => normalizeResultState(result) === "error").length,
    averageResponseLatencyMs: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : 0,
    totalEstimatedCostUsd: costTotal > 0 ? costTotal : undefined,
    criticalFindingsCount: findings.filter((finding) => finding.severity === "critical").length,
    newRegressionsCount: comparison.regressedFindings.length,
    publicExposureCount: findings.filter((finding) => ["recon", "auth", "exfil"].includes(finding.category)).length,
    childSafetyFailuresCount: findings.filter((finding) => finding.category === "child-safety").length,
  };
}

function buildCoverage(results: TestResult[]): ExecutionCoverage {
  const runTrustSignals: TrustSignal[] = [];
  const timeoutCount = results.filter((result) => normalizeResultState(result) === "timeout").length;
  const errorCount = results.filter((result) => normalizeResultState(result) === "error").length;
  const activeCount = results.filter((result) => normalizeResultState(result) !== "idle").length;
  const totalCount = results.length;
  if (activeCount === totalCount && timeoutCount === 0 && errorCount === 0) runTrustSignals.push("fully_executed");
  else runTrustSignals.push("partially_executed");
  if (timeoutCount > 0) runTrustSignals.push("degraded_by_timeouts");
  if (errorCount > 0) runTrustSignals.push("degraded_by_errors");

  const suiteTrustSignals = results.reduce<Record<string, TrustSignal[]>>((acc, result) => {
    const suite = result.category;
    acc[suite] = acc[suite] ?? [];
    const state = normalizeResultState(result);
    if (state === "timeout" && !acc[suite].includes("degraded_by_timeouts")) acc[suite].push("degraded_by_timeouts");
    if (state === "error" && !acc[suite].includes("degraded_by_errors")) acc[suite].push("degraded_by_errors");
    return acc;
  }, {});

  for (const [suite, signals] of Object.entries(suiteTrustSignals)) {
    if (signals.length === 0) suiteTrustSignals[suite] = ["fully_executed"];
  }

  return { runTrustSignals, suiteTrustSignals };
}

function buildOperatorSummary(assessment: {
  findings: FindingRecord[];
  comparison: ReturnType<typeof deriveRunDelta>;
  riskSummary: RiskSummary;
  coverage: ExecutionCoverage;
}): OperatorSummary {
  const keyEvidenceHighlights = assessment.findings.slice(0, 3).map((finding) => `${finding.title}: ${finding.evidence_snapshot.responseSummary}`);
  const overallVerdict = assessment.coverage.runTrustSignals.includes("inconclusive_due_to_target_variance")
    ? "not_comparable"
    : verdictFromOverall(assessment.riskSummary.overallVerdict);
  return {
    overallVerdict,
    highestSeverity: assessment.riskSummary.highestSeverityObserved,
    criticalFindingsCount: assessment.findings.filter((finding) => finding.severity === "critical").length,
    newRegressionsCount: assessment.comparison.regressedFindings.length,
    publicExposureCount: assessment.findings.filter((finding) => ["recon", "auth", "exfil"].includes(finding.category)).length,
    childSafetyFailuresCount: assessment.findings.filter((finding) => finding.category === "child-safety").length,
    recommendedFirstFix: assessment.riskSummary.recommendedFirstFix,
    keyEvidenceHighlights,
    trustSignals: assessment.coverage.runTrustSignals,
    exportActions: [
      { label: "Executive Summary", path: "/reports/latest/EXECUTIVE_SUMMARY.md" },
      { label: "Technical Findings", path: "/reports/latest/TECHNICAL_FINDINGS.md" },
      { label: "Evidence Appendix", path: "/reports/latest/EVIDENCE_APPENDIX.md" },
      { label: "Retest Comparison", path: "/reports/latest/RETEST_COMPARISON.md" },
      { label: "Security Review", path: "/reports/latest/SECURITY_REVIEW.md" },
    ],
  };
}

export async function buildDashboardAssessment(args: {
  target: string;
  targetName?: string;
  results: TestResult[];
  previousFindings?: FindingRecord[];
  targetFingerprint?: TargetFingerprint;
  previousFingerprint?: TargetFingerprint;
  integrity?: DashboardAssessment["integrity"];
}): Promise<DashboardAssessment> {
  const results = [...args.results].sort((a, b) => a.testName.localeCompare(b.testName));
  const findings = (await deriveFindings(results, args.previousFindings ?? [])).filter((finding) => finding.status === "open");
  const gates = deriveGates(results);
  const suites = [...new Set(results.map((result) => result.category))].sort().map((category) => {
    const suiteResults = results.filter((result) => result.category === category);
    return deriveSuiteState(category, suiteResults);
  });
  const fingerprintComparison = compareFingerprints(args.targetFingerprint, args.previousFingerprint);
  const comparison = deriveRunDelta(findings, args.previousFindings ?? [], fingerprintComparison.warning);
  const summary = {
    total: results.length,
    pass: results.filter((result) => result.result === "PASS").length,
    fail: results.filter((result) => result.result === "FAIL").length,
    warn: results.filter((result) => result.result === "WARN").length,
  };
  const riskSummary = buildRiskSummary(findings, gates);
  const coverage = buildCoverage(results);
  if (fingerprintComparison.warning && !coverage.runTrustSignals.includes("inconclusive_due_to_target_variance")) {
    coverage.runTrustSignals.push("inconclusive_due_to_target_variance");
  }
  const metrics = buildMetrics(results, findings, comparison);
  const operatorSummary = buildOperatorSummary({ findings, comparison, riskSummary, coverage });
  const verdict = fingerprintComparison.warning ? "not_comparable" as PlatformVerdict : verdictFromOverall(riskSummary.overallVerdict);

  return {
    generatedAt: new Date().toISOString(),
    target: args.target,
    targetName: args.targetName,
    summary,
    verdict,
    riskSummary,
    operatorSummary,
    metrics,
    coverage,
    integrity: args.integrity,
    targetFingerprint: args.targetFingerprint,
    gates,
    findings,
    suites,
    tests: results,
    comparison,
  };
}

export function upgradeLegacyResult(result: TestResult): TestResult {
  const state = normalizeResultState(result);
  const execution = result.execution ?? {
    state,
    lastRunAt: result.timestamp,
    completedAt: result.timestamp,
    durationMs: result.durationMs,
    attemptCount: result.retry?.attempted ? 2 : 1,
  };

  return {
    ...result,
    state,
    execution,
    normalizedVerdict: result.normalizedVerdict ?? verdictFromResult(result.result, state),
    evaluatorRules: result.evaluatorRules ?? [],
    evidence: result.evidence ?? [],
    confidenceReason: result.confidenceReason ?? {
      level: result.confidence,
      explanation: "Legacy result upgraded without stored confidence explanation; confidence preserved from deterministic verdict.",
    },
    remediationGuidance: result.remediationGuidance ?? result.suggestedImprovements ?? [],
    remediationBlock: result.remediationBlock ?? deriveRemediationBlock(result),
    evidenceSnapshot: result.evidenceSnapshot ?? buildEvidenceSnapshot(
      result,
      result.confidenceReason ?? { level: result.confidence, explanation: "Legacy result upgraded without stored confidence explanation; confidence preserved from deterministic verdict." },
      result.remediationBlock ?? deriveRemediationBlock(result),
    ),
    transparency: result.transparency ?? { timeline: [] },
  };
}
