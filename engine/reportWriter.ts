import fs from "fs-extra";
import path from "path";
import { TestResult } from "./types";

function safeName(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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

  await fs.writeJson(jsonPath, result, { spaces: 2 });

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
${result.rawResponseSnippet}
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
