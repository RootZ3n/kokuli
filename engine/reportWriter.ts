import fs from "fs-extra";
import path from "path";
import { TestResult } from "./types";
import { LedgerSummary, LedgerEntry } from "./ledger";

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
