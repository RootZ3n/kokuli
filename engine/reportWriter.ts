import fs from "fs-extra";
import path from "path";
import { buildDashboardAssessment, upgradeLegacyResult } from "./assessment";
import { captureTargetFingerprint } from "./fingerprint";
import { appendAssessmentSnapshot, getLatestSnapshot, verifyIntegrityChain, loadAssessmentHistory } from "./history";
import { DashboardAssessment, TargetConfig, TestResult } from "./types";
import { LedgerSummary, LedgerEntry } from "./ledger";
import { verdictLabel } from "./verdicts";

function safeName(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Redact sensitive patterns (API keys, bearer tokens, long base64 strings) from report text */
function sanitizeForReport(text: string): string {
  let sanitized = text;
  // API key patterns (sk-...)
  sanitized = sanitized.replace(/sk-[a-zA-Z0-9]{20,}/g, "sk-[REDACTED]");
  // Bearer tokens
  sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9._-]+/g, "Bearer [REDACTED]");
  // Long base64-like strings that may be tokens (40+ chars of base64 alphabet)
  sanitized = sanitized.replace(/[A-Za-z0-9+/=]{40,}/g, (match) => {
    // Only redact if it looks like base64 (has mixed case or special base64 chars)
    if (/[+/=]/.test(match) || (/[A-Z]/.test(match) && /[a-z]/.test(match))) {
      return "[REDACTED_TOKEN]";
    }
    return match;
  });
  return sanitized;
}

function formatParsedFields(result: TestResult): string {
  const p = result.parsedFields;
  const lines: string[] = [];

  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| HTTP Status | ${p.httpStatus} |`);
  lines.push(`| Has Output | ${p.hasOutput} |`);
  lines.push(`| Has Receipt ID | ${p.hasReceiptId} |`);

  if (p.receiptId) lines.push(`| Receipt ID | \`${p.receiptId}\` |`);
  if (p.provider) lines.push(`| Provider | ${p.provider} |`);
  if (p.model) lines.push(`| Model | ${p.model} |`);
  if (p.activeModel) lines.push(`| Active Model | ${p.activeModel} |`);
  if (p.tier) lines.push(`| Tier | ${p.tier} |`);
  if (p.escalated !== undefined) lines.push(`| Escalated | ${p.escalated} |`);
  if (p.contextUsed !== undefined) lines.push(`| Context Used | ${p.contextUsed} |`);
  if (p.memoryHitCount !== undefined) lines.push(`| Memory Hits | ${p.memoryHitCount} |`);
  if (p.gatewayBlock) lines.push(`| Gateway Block | true |`);
  if (p.gatewayReason) lines.push(`| Gateway Reason | \`${p.gatewayReason}\` |`);

  return lines.join("\n");
}

export async function writeReport(result: TestResult): Promise<void> {
  const baseName = `${safeName(result.testId)}-${safeName(result.testName)}`;
  const latestDir = path.join(process.cwd(), "reports", "latest");

  const jsonPath = path.join(latestDir, `${baseName}.json`);
  const mdPath = path.join(latestDir, `${baseName}.md`);

  // Sanitize raw response snippet before writing to reports
  const sanitizedResult = { ...result, rawResponseSnippet: sanitizeForReport(result.rawResponseSnippet) };

  await fs.writeJson(jsonPath, sanitizedResult, { spaces: 2 });

  const retryNote = result.retry.attempted
    ? `\n> **Note:** This test required a retry. Original error: ${result.retry.originalError}\n`
    : "";

  const md = `# ${result.testName}

**Test ID:** ${result.testId}
**Category:** ${result.category}
**Target:** ${result.target}
**Purpose:** ${result.purpose}
**Timestamp:** ${result.timestamp}
**Duration:** ${result.durationMs}ms
**Result:** ${result.result}
**Confidence:** ${result.confidence}
${retryNote}
## Expected Behavior

${result.expectedBehavior}

## Observed Behavior

${result.observedBehavior}

## Parsed Response Fields

${formatParsedFields(result)}

## Suggested Improvements

${
  result.suggestedImprovements.length
    ? result.suggestedImprovements.map((x) => `- ${x}`).join("\n")
    : "- None"
}

## Raw Response Snippet

\`\`\`
${sanitizedResult.rawResponseSnippet}
\`\`\`
`;

  await fs.writeFile(mdPath, md, "utf8");
}

export async function readLatestResults(): Promise<TestResult[]> {
  const latestDir = path.join(process.cwd(), "reports", "latest");
  if (!(await fs.pathExists(latestDir))) return [];
  const files = (await fs.readdir(latestDir))
    .filter((file) =>
      file.endsWith(".json") &&
      !["SUMMARY.json", "ASSESSMENT.json", "EXECUTION.json", "EVIDENCE_APPENDIX.json"].includes(file),
    )
    .sort();

  const reports: TestResult[] = [];
  for (const file of files) {
    try {
      const data = await fs.readJson(path.join(latestDir, file)) as TestResult;
      reports.push(upgradeLegacyResult(data));
    } catch {
      // skip malformed artifacts
    }
  }
  return reports;
}

export async function writeSuiteSummary(results: TestResult[]): Promise<void> {
  const latestDir = path.join(process.cwd(), "reports", "latest");
  const summaryPath = path.join(latestDir, "SUMMARY.md");

  const pass = results.filter((r) => r.result === "PASS").length;
  const fail = results.filter((r) => r.result === "FAIL").length;
  const warn = results.filter((r) => r.result === "WARN").length;

  const lines: string[] = [
    `# Suite Summary`,
    ``,
    `**Timestamp:** ${new Date().toISOString()}`,
    `**Total:** ${results.length} | **PASS:** ${pass} | **FAIL:** ${fail} | **WARN:** ${warn}`,
    ``,
    `| Test | Category | Result | Duration | Receipt |`,
    `|------|----------|--------|----------|---------|`,
  ];

  for (const r of results) {
    const receiptTag = r.parsedFields.hasReceiptId ? `\`${r.parsedFields.receiptId?.slice(0, 8)}...\`` : "—";
    lines.push(`| ${r.testName} | ${r.category} | **${r.result}** | ${r.durationMs}ms | ${receiptTag} |`);
  }

  lines.push("");
  await fs.writeFile(summaryPath, lines.join("\n"), "utf8");

  const summaryJsonPath = path.join(latestDir, "SUMMARY.json");
  await fs.writeJson(summaryJsonPath, { timestamp: new Date().toISOString(), total: results.length, pass, fail, warn, results: results.map((r) => ({ testId: r.testId, testName: r.testName, category: r.category, result: r.result, durationMs: r.durationMs, receiptId: r.parsedFields.receiptId })) }, { spaces: 2 });
}

function formatAssessmentSummary(assessment: DashboardAssessment): string {
  const risk = assessment.riskSummary;
  return [
    `**Target:** ${assessment.targetName ?? assessment.target}`,
    `**Generated:** ${assessment.generatedAt}`,
    `**Verdict:** ${verdictLabel(assessment.verdict)}`,
    `**Fingerprint Signature:** ${assessment.targetFingerprint?.signature ?? "n/a"}`,
    `**Integrity:** ${assessment.integrity?.status ?? "n/a"}${assessment.integrity?.warning ? ` (${assessment.integrity.warning})` : ""}`,
    `**Overall Verdict:** ${risk.overallVerdict}`,
    `**Highest Severity Observed:** ${risk.highestSeverityObserved}`,
    `**Exploitable Findings:** ${risk.exploitableFindingsCount}`,
    `**Public Exposure Findings:** ${risk.publicExposureFindingsCount}`,
    `**Child Safety Failures:** ${risk.childSafetyFailuresCount}`,
    `**Recommended First Fix:** ${risk.recommendedFirstFix}`,
  ].join("\n");
}

function renderExecutiveSummaryMarkdown(assessment: DashboardAssessment): string {
  const operator = assessment.operatorSummary;
  const lines = [
    `# Krakzen Executive Summary`,
    ``,
    formatAssessmentSummary(assessment),
    ``,
    `## Operator Summary`,
    ``,
    `- Critical findings: ${operator.criticalFindingsCount}`,
    `- New regressions: ${operator.newRegressionsCount}`,
    `- Public exposure findings: ${operator.publicExposureCount}`,
    `- Child safety failures: ${operator.childSafetyFailuresCount}`,
    `- Trust signals: ${operator.trustSignals.join(", ") || "none"}`,
    `- Recommended first fix: ${operator.recommendedFirstFix}`,
    `- Key evidence highlights: ${operator.keyEvidenceHighlights.join(" | ") || "none"}`,
    ``,
    `## Performance Metrics`,
    ``,
    `- Total run duration: ${assessment.metrics.totalRunDurationMs}ms`,
    `- Average response latency: ${assessment.metrics.averageResponseLatencyMs}ms`,
    `- Blocked count: ${assessment.metrics.blockedCount}`,
    `- Error count: ${assessment.metrics.errorCount}`,
    `- Timeout count: ${assessment.metrics.timeoutCount}`,
    `- Estimated cost total: ${assessment.metrics.totalEstimatedCostUsd != null ? `$${assessment.metrics.totalEstimatedCostUsd.toFixed(4)}` : "n/a"}`,
    ``,
    `## Gates`,
    ``,
    `| Gate | Status | Notes |`,
    `|------|--------|-------|`,
    ...assessment.gates.map((gate) => `| ${gate.title} | ${gate.status.toUpperCase()} | ${gate.explanation} |`),
    ``,
    `## Run Comparison`,
    ``,
    `- New findings: ${assessment.comparison.newFindings.length}`,
    `- Resolved findings: ${assessment.comparison.resolvedFindings.length}`,
    `- Regressed findings: ${assessment.comparison.regressedFindings.length}`,
    `- Unchanged findings: ${assessment.comparison.unchangedFindings.length}`,
    `- Comparability warning: ${assessment.comparison.comparabilityWarning ?? "none"}`,
  ];
  return lines.join("\n");
}

function renderTechnicalFindingsMarkdown(assessment: DashboardAssessment): string {
  const lines = [
    `# Krakzen Technical Findings`,
    ``,
    formatAssessmentSummary(assessment),
    ``,
  ];

  if (!assessment.findings.length) {
    lines.push(`No active findings in the latest target assessment.`);
    return lines.join("\n");
  }

  for (const finding of assessment.findings) {
    lines.push(`## ${finding.title}`);
    lines.push(``);
    lines.push(`- Finding ID: \`${finding.id}\``);
    lines.push(`- Category: ${finding.category}`);
    lines.push(`- Severity: ${finding.severity}`);
    lines.push(`- Lifecycle: ${finding.lifecycle}`);
    lines.push(`- Workflow state: ${finding.workflow_state ?? "detected"}`);
    lines.push(`- Verdict: ${verdictLabel(finding.verdict ?? "concern")}`);
    lines.push(`- Exploitability: ${finding.exploitability}`);
    lines.push(`- Target: ${finding.target}`);
    lines.push(`- Test: ${finding.test_id}`);
    lines.push(`- First seen: ${finding.first_seen_at}`);
    lines.push(`- Last seen: ${finding.last_seen_at}`);
    lines.push(`- Regression: ${finding.regression ? "yes" : "no"}`);
    lines.push(`- Confidence: ${finding.confidence} (${finding.confidence_reason})`);
    lines.push(`- Evidence: ${finding.evidence_summary}`);
    lines.push(`- Evidence snapshot: attack=${finding.evidence_snapshot.attackSummary} | response=${finding.evidence_snapshot.responseSummary} | evaluator=${finding.evidence_snapshot.evaluatorSummary} | confidence=${finding.evidence_snapshot.confidenceSummary} | why=${finding.evidence_snapshot.whyItMatters}`);
    lines.push(`- Provenance: ${(finding.provenance || []).map((rule) => `${rule.id}@${rule.version} [${rule.family}] ${rule.conditionSummary}`).join("; ") || "none"}`);
    if (finding.suppression) {
      lines.push(`- Suppression: reason=${finding.suppression.reason}; timestamp=${finding.suppression.timestamp}; owner=${finding.suppression.owner ?? "n/a"}; expiry=${finding.suppression.expiry ?? "n/a"}; warning=${finding.suppression.governanceWarning ?? "none"}`);
    }
    lines.push(`- Remediation: ${finding.remediation_summary}`);
    lines.push(`  Why: ${finding.remediation_block.whyItMatters}`);
    lines.push(`  Attacker benefit if unfixed: ${finding.remediation_block.attackerBenefitIfUnfixed}`);
    lines.push(`  Retest: ${finding.remediation_block.retestSuggestion}`);
    lines.push(``);
  }

  return lines.join("\n");
}

function renderEvidenceAppendixMarkdown(assessment: DashboardAssessment): string {
  const lines = [
    `# Krakzen Evidence Appendix`,
    ``,
    formatAssessmentSummary(assessment),
    ``,
  ];

  for (const test of assessment.tests) {
    lines.push(`## ${test.testName}`);
    lines.push(``);
    lines.push(`- State: ${test.execution?.state ?? test.state ?? "idle"}`);
    lines.push(`- Result: ${test.result}`);
    lines.push(`- Verdict: ${verdictLabel(test.normalizedVerdict ?? "inconclusive")}`);
    lines.push(`- Last run: ${test.execution?.lastRunAt ?? test.timestamp}`);
    lines.push(`- Duration: ${test.durationMs}ms`);
    lines.push(`- Attempts: ${test.execution?.attemptCount ?? 1}`);
    lines.push(`- Fingerprint signature: ${test.targetFingerprint?.signature ?? assessment.targetFingerprint?.signature ?? "n/a"}`);
    lines.push(`- Threat intent: ${test.threatProfile?.intent ?? test.purpose}`);
    lines.push(`- Expected safe behavior: ${test.threatProfile?.expectedSafeBehavior ?? test.expectedBehavior}`);
    lines.push(`- Failure criteria: ${(test.threatProfile?.failureCriteria ?? []).join(" | ") || "n/a"}`);
    lines.push(`- Request: \`${test.request?.method ?? "POST"} ${test.request?.url ?? "n/a"}\``);
    lines.push(`- Evaluator rules: ${(test.evaluatorRules ?? []).map((rule) => `${rule.id}@${rule.version}:${rule.family}:${rule.conditionSummary}`).join("; ") || "none"}`);
    lines.push(`- Confidence reasoning: ${test.confidenceReason?.explanation ?? "n/a"}`);
    lines.push(`- Evidence: ${(test.evidence ?? []).map((entry) => `${entry.label}=${entry.value}`).join("; ") || "none"}`);
    lines.push(`- Evidence snapshot: ${test.evidenceSnapshot ? `${test.evidenceSnapshot.attackSummary} | ${test.evidenceSnapshot.responseSummary} | ${test.evidenceSnapshot.evaluatorSummary}` : "n/a"}`);
    lines.push(`- Remediation: ${test.remediationBlock ? `${test.remediationBlock.whatToChange} | why=${test.remediationBlock.whyItMatters} | attacker=${test.remediationBlock.attackerBenefitIfUnfixed} | retest=${test.remediationBlock.retestSuggestion}` : ((test.remediationGuidance ?? test.suggestedImprovements).join("; ") || "none")}`);
    lines.push(``);
    lines.push("```json");
    lines.push(JSON.stringify({
      request: test.request,
      response: test.response,
      transparency: test.transparency,
      targetFingerprint: test.targetFingerprint ?? assessment.targetFingerprint,
      priorRunComparison: test.priorRunComparison,
    }, null, 2));
    lines.push("```");
    lines.push(``);
  }

  return lines.join("\n");
}

function renderRemediationChecklistMarkdown(assessment: DashboardAssessment): string {
  const lines = [
    `# Krakzen Remediation Checklist`,
    ``,
    formatAssessmentSummary(assessment),
    ``,
  ];

  if (!assessment.findings.length) {
    lines.push(`- [x] No active findings in the latest assessment.`);
    return lines.join("\n");
  }

  for (const finding of assessment.findings) {
    lines.push(`- [ ] ${finding.title} (${finding.severity}, ${finding.category})`);
    lines.push(`  Remediation: ${finding.remediation_block.whatToChange}`);
    lines.push(`  Why: ${finding.remediation_block.whyItMatters}`);
    lines.push(`  Retest: ${finding.remediation_block.retestSuggestion}`);
  }

  return lines.join("\n");
}

function renderRetestComparisonMarkdown(assessment: DashboardAssessment): string {
  const lines = [
    `# Krakzen Retest Comparison`,
    ``,
    formatAssessmentSummary(assessment),
    ``,
    `Previous comparable run: ${assessment.comparison.previousRunAt ?? "none"}`,
    ``,
    `## Delta`,
    ``,
    `- New findings: ${assessment.comparison.newFindings.length}`,
    `- Recurring findings: ${assessment.comparison.recurringFindings.length}`,
    `- Resolved findings: ${assessment.comparison.resolvedFindings.length}`,
    `- Regressed findings: ${assessment.comparison.regressedFindings.length}`,
    `- Unchanged findings: ${assessment.comparison.unchangedFindings.length}`,
    `- Not directly comparable: ${assessment.comparison.notComparableFindings.length}`,
    `- Comparability warning: ${assessment.comparison.comparabilityWarning ?? "none"}`,
  ];
  return lines.join("\n");
}

export function renderSecurityReviewMarkdown(assessment: DashboardAssessment): string {
  const lines = [
    `# Krakzen Security Review`,
    ``,
    `## Scope`,
    ``,
    `- Target: ${assessment.targetName ?? assessment.target}`,
    `- Timestamp: ${assessment.generatedAt}`,
    `- Verdict: ${verdictLabel(assessment.verdict)}`,
    ``,
    `## Target Fingerprint`,
    ``,
    `- Base URL: ${assessment.targetFingerprint?.baseUrl ?? "n/a"}`,
    `- Signature: ${assessment.targetFingerprint?.signature ?? "n/a"}`,
    `- Auth posture: ${assessment.targetFingerprint?.authPostureSummary ?? "n/a"}`,
    `- Version/build metadata: ${assessment.targetFingerprint?.versionMetadata ?? "n/a"}`,
    ``,
    `## Comparability And Integrity`,
    ``,
    `- Comparability: ${assessment.comparison.comparabilityWarning ?? "Comparable to prior run."}`,
    `- Integrity status: ${assessment.integrity?.status ?? "n/a"}${assessment.integrity?.warning ? ` (${assessment.integrity.warning})` : ""}`,
    `- Trust signals: ${(assessment.coverage.runTrustSignals || []).join(", ") || "none"}`,
    ``,
    `## Key Findings`,
    ``,
  ];

  for (const finding of assessment.findings.slice(0, 10)) {
    lines.push(`### ${finding.title}`);
    lines.push(`- Verdict: ${verdictLabel(finding.verdict ?? "concern")}`);
    lines.push(`- Lifecycle: ${finding.lifecycle}`);
    lines.push(`- Workflow: ${finding.workflow_state ?? "detected"}`);
    lines.push(`- Evidence snapshot: ${finding.evidence_snapshot.attackSummary} | ${finding.evidence_snapshot.responseSummary} | ${finding.evidence_snapshot.evaluatorSummary}`);
    lines.push(`- Recommended first change: ${finding.remediation_block.whatToChange}`);
    if (finding.suppression) lines.push(`- Suppression: ${finding.suppression.reason} (${finding.suppression.governanceWarning ?? "active"})`);
    lines.push(``);
  }

  lines.push(`## Remediation Order`);
  lines.push(``);
  lines.push(...assessment.findings.slice(0, 5).map((finding, index) => `${index + 1}. ${finding.title}: ${finding.remediation_block.whatToChange}`));
  lines.push(``);
  lines.push(`## Retest Criteria`);
  lines.push(``);
  lines.push(...assessment.findings.slice(0, 5).map((finding) => `- ${finding.title}: ${finding.remediation_block.retestSuggestion}`));
  lines.push(``);
  lines.push(`## Suppressions And Accepted Risks`);
  lines.push(``);
  const suppressions = assessment.findings.filter((finding) => finding.suppression);
  lines.push(...(suppressions.length ? suppressions.map((finding) => `- ${finding.title}: ${finding.suppression?.reason}; warning=${finding.suppression?.governanceWarning ?? "none"}`) : ["- None"]));
  lines.push(``);
  lines.push(`## Regression Summary`);
  lines.push(``);
  lines.push(`- New findings: ${assessment.comparison.newFindings.length}`);
  lines.push(`- Recurring findings: ${assessment.comparison.recurringFindings.length}`);
  lines.push(`- Regressed findings: ${assessment.comparison.regressedFindings.length}`);
  lines.push(`- Resolved findings: ${assessment.comparison.resolvedFindings.length}`);
  lines.push(`- Not directly comparable: ${assessment.comparison.notComparableFindings.length}`);
  return lines.join("\n");
}

export async function writeAssessmentBundle(args: {
  target: string;
  targetName?: string;
  targetConfig?: TargetConfig;
  results?: TestResult[];
}): Promise<DashboardAssessment> {
  const latestDir = path.join(process.cwd(), "reports", "latest");
  await fs.ensureDir(latestDir);

  const results = args.results ? args.results.map(upgradeLegacyResult) : await readLatestResults();
  const previous = await getLatestSnapshot(args.target);
  const targetFingerprint = args.targetConfig ? await captureTargetFingerprint(args.target, args.targetConfig) : undefined;
  const assessment = await buildDashboardAssessment({
    target: args.target,
    targetName: args.targetName,
    results,
    previousFindings: previous?.findings,
    targetFingerprint,
    previousFingerprint: previous?.targetFingerprint,
  });

  await appendAssessmentSnapshot(assessment);
  const integrity = verifyIntegrityChain(await loadAssessmentHistory());
  if (integrity) assessment.integrity = integrity;

  await fs.writeJson(path.join(latestDir, "ASSESSMENT.json"), assessment, { spaces: 2 });
  await fs.writeFile(path.join(latestDir, "EXECUTIVE_SUMMARY.md"), renderExecutiveSummaryMarkdown(assessment), "utf8");
  await fs.writeFile(path.join(latestDir, "TECHNICAL_FINDINGS.md"), renderTechnicalFindingsMarkdown(assessment), "utf8");
  await fs.writeFile(path.join(latestDir, "EVIDENCE_APPENDIX.md"), renderEvidenceAppendixMarkdown(assessment), "utf8");
  await fs.writeJson(path.join(latestDir, "EVIDENCE_APPENDIX.json"), assessment.tests, { spaces: 2 });
  await fs.writeFile(path.join(latestDir, "REMEDIATION_CHECKLIST.md"), renderRemediationChecklistMarkdown(assessment), "utf8");
  await fs.writeFile(path.join(latestDir, "RETEST_COMPARISON.md"), renderRetestComparisonMarkdown(assessment), "utf8");
  await fs.writeFile(path.join(latestDir, "SECURITY_REVIEW.md"), renderSecurityReviewMarkdown(assessment), "utf8");
  return assessment;
}

export async function writeTransparencyReport(summary: LedgerSummary, entries: LedgerEntry[]): Promise<void> {
  const latestDir = path.join(process.cwd(), "reports", "latest");
  await fs.ensureDir(latestDir);
  const reportPath = path.join(latestDir, "TRANSPARENCY.md");

  const lines: string[] = [
    `# Transparency Report`,
    ``,
    `**Generated:** ${new Date().toISOString()}`,
    ``,
    `## Overview`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total Requests | ${summary.totalRequests} |`,
    `| Tokens In | ${summary.totalTokensIn.toLocaleString()} |`,
    `| Tokens Out | ${summary.totalTokensOut.toLocaleString()} |`,
    `| Estimated Cost | $${summary.totalEstimatedCostUsd.toFixed(4)} |`,
    `| Total Duration | ${(summary.totalDurationMs / 1000).toFixed(1)}s |`,
    ``,
    `## Model Breakdown`,
    ``,
    `| Model | Requests | Tokens In | Tokens Out | Cost |`,
    `|-------|----------|-----------|------------|------|`,
  ];

  for (const [model, data] of Object.entries(summary.modelBreakdown)) {
    lines.push(`| ${model} | ${data.count} | ${data.tokensIn.toLocaleString()} | ${data.tokensOut.toLocaleString()} | $${data.costUsd.toFixed(4)} |`);
  }

  lines.push(``);
  lines.push(`## Provider Breakdown`);
  lines.push(``);
  lines.push(`| Provider | Requests | Tokens In | Tokens Out | Cost |`);
  lines.push(`|----------|----------|-----------|------------|------|`);

  for (const [provider, data] of Object.entries(summary.providerBreakdown)) {
    lines.push(`| ${provider} | ${data.count} | ${data.tokensIn.toLocaleString()} | ${data.tokensOut.toLocaleString()} | $${data.costUsd.toFixed(4)} |`);
  }

  lines.push(``);
  lines.push(`## Result Breakdown`);
  lines.push(``);
  lines.push(`| Result | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| PASS | ${summary.resultBreakdown.pass} |`);
  lines.push(`| FAIL | ${summary.resultBreakdown.fail} |`);
  lines.push(`| WARN | ${summary.resultBreakdown.warn} |`);

  lines.push(``);
  lines.push(`## Target Breakdown`);
  lines.push(``);
  lines.push(`| Target | Requests |`);
  lines.push(`|--------|----------|`);

  for (const [target, count] of Object.entries(summary.targetBreakdown)) {
    lines.push(`| ${target} | ${count} |`);
  }

  // Last 20 entries
  const recentEntries = entries.slice(-20);
  if (recentEntries.length > 0) {
    lines.push(``);
    lines.push(`## Recent Entries (last ${recentEntries.length})`);
    lines.push(``);
    lines.push(`| Time | Test | Model | Tokens | Cost | Result |`);
    lines.push(`|------|------|-------|--------|------|--------|`);

    for (const e of recentEntries) {
      const time = e.timestamp.slice(11, 19);
      const tokens = `${e.tokensIn ?? 0}/${e.tokensOut ?? 0}`;
      const cost = e.estimatedCostUsd != null ? `$${e.estimatedCostUsd.toFixed(4)}` : "—";
      lines.push(`| ${time} | ${e.testId} | ${e.model ?? "—"} | ${tokens} | ${cost} | ${e.result} |`);
    }
  }

  lines.push(``);
  await fs.writeFile(reportPath, lines.join("\n"), "utf8");
}
