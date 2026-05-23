#!/usr/bin/env node
// scripts/verum-diagnostic.mjs
//
// Pre-release trust diagnostic for Verum.
//
// Runs entirely offline against the test pack + dist/ build artifacts. Does
// not contact a target, does not run any test. Its job is to answer:
//
//   "Could Verum currently produce a confident false security report?"
//
// Exits non-zero (and prints a clear summary) when any of the following is
// true:
//
//   - duplicate test IDs in the test pack
//   - production test missing prompt / criteria / category / severity
//   - mock/demo test marked as production (no namespace prefix, no flag)
//   - bridge index includes a "passed" run with allInconclusive=true
//   - exact-string-only leak detection lacks paraphrase coverage
//     (asserted by importing the evaluator regex list)
//   - the evaluator no-evidence guard is missing
//   - the assessment summary lacks `inconclusive` / `counted` fields
//
// This is gate-grade. CI/release scripts should invoke it directly.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function walk(dir, ext) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(fp, ext));
    else if (entry.isFile() && fp.endsWith(ext)) out.push(fp);
  }
  return out;
}

function loadValidation() {
  // The compiled validation module lives under dist/. We rely on the build
  // having been run; the CLI smoke / release verify steps do so.
  const distPath = path.join(ROOT, "dist", "engine", "validation.js");
  if (!fs.existsSync(distPath)) {
    throw new Error(`Diagnostic requires a build. Missing ${distPath}. Run \`npm run build\` first.`);
  }
  return require(distPath);
}

// Avoid ESM/CJS quirks by deferring require to runtime
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const findings = [];
const warnings = [];
const summary = {
  totalTests: 0,
  duplicateIds: 0,
  duplicatePrompts: 0,
  missingPrompts: 0,
  missingCriteria: 0,
  missingSeverity: 0,
  missingCategory: 0,
  invalidCategory: 0,
  mockDemoCount: 0,
  emptyStepCount: 0,
  fuzzMisconfigured: 0,
  bridgeIndexEntries: 0,
  bridgeAllInconclusivePassed: 0,
  unknownProviderHistorical: 0,
  unknownProviderCurrent: 0,
  productionTestIds: 0,
  evaluatorHasParaphraseList: false,
  evaluatorHasNoEvidenceGate: false,
  assessmentHasInconclusiveField: false,
  multiTurnTests: 0,
  multiTurnAggregatorWired: false,
  unannotatedNoPayload: 0,
  vestigialEmptySteps: 0,
};

function record(level, code, message) {
  (level === "error" ? findings : warnings).push({ code, message });
}

// --- 1. Validate the test pack -----------------------------------------------

const validation = loadValidation();
const report = await validation.validateTestPack(path.join(ROOT, "tests"));

summary.totalTests = report.total;
summary.duplicateIds = report.duplicates.length;
summary.duplicatePrompts = report.duplicatePrompts.length;
summary.mockDemoCount = report.mockOrDemo.length;
summary.productionTestIds = report.productionTestIds.length;

for (const issue of report.issues) {
  if (issue.code === "DUPLICATE_ID") {
    record("error", "DUPLICATE_ID", `${issue.testId}: ${issue.message}`);
  } else if (issue.code === "MISSING_INPUT" || issue.code === "TRIVIAL_INPUT") {
    summary.missingPrompts++;
    record("error", issue.code, `${issue.testId}: ${issue.message}`);
  } else if (issue.code === "MISSING_EXPECTED_BEHAVIOR") {
    summary.missingCriteria++;
    record("error", issue.code, `${issue.testId}: ${issue.message}`);
  } else if (issue.code === "INVALID_SEVERITY") {
    summary.missingSeverity++;
    record("error", issue.code, `${issue.testId}: ${issue.message}`);
  } else if (issue.code === "MISSING_CATEGORY") {
    summary.missingCategory++;
    record("error", issue.code, `${issue.testId}: ${issue.message}`);
  } else if (issue.code === "INVALID_CATEGORY") {
    summary.invalidCategory++;
    record("error", issue.code, `${issue.testId}: ${issue.message}`);
  } else if (issue.code === "EMPTY_STEPS" || issue.code === "EMPTY_STEPS_VESTIGIAL") {
    summary.emptyStepCount++;
    summary.vestigialEmptySteps++;
    // Both are now release-blocking: an empty steps array is a footgun.
    record("error", issue.code, `${issue.testId}: ${issue.message}`);
  } else if (issue.code === "SINGLE_STEP_MULTITURN") {
    record("warning", issue.code, `${issue.testId}: ${issue.message}`);
  } else if (issue.code === "ENDPOINT_NO_PAYLOAD_UNANNOTATED") {
    summary.unannotatedNoPayload++;
    record("error", issue.code, `${issue.testId}: ${issue.message}`);
  } else if (issue.code === "MISSING_MULTITURN_AGGREGATION" ||
             issue.code === "INVALID_AGGREGATION_MODE" ||
             issue.code === "MISSING_REQUIRED_TURN_EVIDENCE" ||
             issue.code === "INVALID_TURN_EVIDENCE") {
    record("error", issue.code, `${issue.testId}: ${issue.message}`);
  } else if (issue.code === "FUZZ_NO_BASE_INPUT" || issue.code === "FUZZ_NO_MUTATIONS" || issue.code === "FUZZ_BAD_ITERATIONS") {
    summary.fuzzMisconfigured++;
    record("error", issue.code, `${issue.testId}: ${issue.message}`);
  } else if (issue.code === "SEVERITY_UNSUPPORTED") {
    record("error", issue.code, `${issue.testId}: ${issue.message}`);
  } else if (issue.severity === "error") {
    record("error", issue.code, `${issue.testId}: ${issue.message}`);
  } else {
    record("warning", issue.code, `${issue.testId}: ${issue.message}`);
  }
}

// --- 2. Evaluator hardening checks ------------------------------------------

const evaluatorPath = path.join(ROOT, "engine", "evaluator.ts");
const evaluatorSrc = fs.readFileSync(evaluatorPath, "utf8");
summary.evaluatorHasParaphraseList = /LEAK_PARAPHRASE_PATTERNS/.test(evaluatorSrc);
summary.evaluatorHasNoEvidenceGate = /decideNoEvidenceForChat|decideNoEvidenceForEndpoint/.test(evaluatorSrc);

if (!summary.evaluatorHasParaphraseList) {
  record("error", "EXACT_STRING_LEAK_DETECTOR", "evaluator no longer carries paraphrase leak detection (LEAK_PARAPHRASE_PATTERNS missing). Exact-string-only detection cannot catch paraphrased system-prompt leaks.");
}
if (!summary.evaluatorHasNoEvidenceGate) {
  record("error", "NO_EVIDENCE_GATE_MISSING", "evaluator no-evidence gate (decideNoEvidenceForChat / decideNoEvidenceForEndpoint) is missing. Transport failures and empty bodies could silently PASS safety tests.");
}

// Sanity: refuse to allow the old gateway-block phrase "policy" or "invalid"
// to mark a 400 response as a security pass.
if (/t\.includes\("policy"\)/.test(evaluatorSrc) || /t\.includes\("invalid"\)/.test(evaluatorSrc)) {
  record("error", "WEAK_GATEWAY_BLOCK", "evaluator's gateway-block detection still treats 'policy' or 'invalid' substrings as gateway blocks. Generic 400 errors would be misclassified as security passes.");
}

// --- 3. Assessment summary contract -----------------------------------------

const assessmentPath = path.join(ROOT, "engine", "assessment.ts");
const assessmentSrc = fs.readFileSync(assessmentPath, "utf8");
summary.assessmentHasInconclusiveField = /inconclusive:\s*inconclusive/.test(assessmentSrc) || /summary\.inconclusive/.test(assessmentSrc) || /inconclusive_due_to_no_evidence/.test(assessmentSrc);

if (!/isCountedTowardScore/.test(assessmentSrc)) {
  record("error", "SCORE_GATING_MISSING", "assessment.ts does not gate score aggregation on isCountedTowardScore. No-evidence results would inflate PASS counts.");
}
if (!summary.assessmentHasInconclusiveField) {
  record("error", "INCONCLUSIVE_FIELD_MISSING", "assessment.ts does not surface an inconclusive count in the summary.");
}

// --- 4. Bridge / INDEX.jsonl honesty ----------------------------------------

const indexPath = path.join(ROOT, "reports", "bridge", "INDEX.jsonl");
if (fs.existsSync(indexPath)) {
  const lines = fs.readFileSync(indexPath, "utf8").split("\n").filter((line) => line.trim());
  summary.bridgeIndexEntries = lines.length;
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.status === "passed" && entry.summary && entry.summary.allInconclusive) {
        summary.bridgeAllInconclusivePassed++;
        record("error", "BRIDGE_INDEX_OVERSTATES", `Bridge run ${entry.runId} is marked passed but allInconclusive=true.`);
      }
      if (entry.status === "passed" && entry.summary && entry.summary.totalTests > 0 && (entry.summary.passed + entry.summary.failed === 0)) {
        record("warning", "BRIDGE_INDEX_PASSED_NO_TESTS", `Bridge run ${entry.runId} is marked passed but reports 0 counted tests.`);
      }
    } catch {
      record("warning", "BRIDGE_INDEX_PARSE", "INDEX.jsonl contains a non-JSON line.");
    }
  }
}

// --- 5. Ledger honesty: historical vs current unknown provider --------------
//
// Pre-honesty-flag entries don't carry schemaVersion. They are HISTORICAL —
// visible in transparency but bucketed separately so they cannot contaminate
// the current-run provider summary. A current-schema entry without provider
// is a real, actionable UNKNOWN_PROVIDER finding.

const ledgerPath = path.join(ROOT, "reports", "ledger.json");
if (fs.existsSync(ledgerPath)) {
  const ledger = readJsonSafe(ledgerPath) ?? { entries: [] };
  const entries = Array.isArray(ledger.entries) ? ledger.entries : Array.isArray(ledger) ? ledger : [];
  for (const entry of entries) {
    const isHistorical = entry.schemaVersion === undefined;
    const noProvider = !entry.provider;
    const noModel = !entry.model;
    if (noProvider || noModel) {
      if (isHistorical) {
        summary.unknownProviderHistorical++;
      } else {
        summary.unknownProviderCurrent++;
        // Current-run unknown without honesty-flag tag is a release blocker.
        const hasHonesty = Array.isArray(entry.honestyFlags) && entry.honestyFlags.some(
          (f) => f === "UNKNOWN_PROVIDER" || f === "UNKNOWN_MODEL",
        );
        if (!hasHonesty) {
          record("error", "LEDGER_CURRENT_UNKNOWN_NO_FLAG",
            `Ledger entry ${entry.id} (current schema) lacks provider/model and has no UNKNOWN_PROVIDER/UNKNOWN_MODEL honesty flag.`);
        }
      }
    }
  }
}

// --- 6. Multi-turn aggregator must be wired ---------------------------------
//
// A multi-turn test that ran step-by-step but never invoked the aggregator
// would silently fall back to "sum the step verdicts" — the exact pre-audit
// failure mode. Verify the CLI imports and uses the aggregator.

const cliPath = path.join(ROOT, "engine", "cli.ts");
const cliSrc = fs.readFileSync(cliPath, "utf8");
summary.multiTurnAggregatorWired = /aggregateMultiTurn\s*\(/.test(cliSrc) && /markStepsAsPartialEvidence/.test(cliSrc);
if (!summary.multiTurnAggregatorWired) {
  record("error", "MULTITURN_AGGREGATOR_NOT_WIRED",
    "engine/cli.ts no longer invokes aggregateMultiTurn + markStepsAsPartialEvidence. Step verdicts could silently inflate multi-turn run summaries.");
}

// Count multi-turn tests for visibility
const mtFiles = fs.existsSync(path.join(ROOT, "tests", "multi-turn"))
  ? fs.readdirSync(path.join(ROOT, "tests", "multi-turn")).filter((f) => f.endsWith(".json"))
  : [];
summary.multiTurnTests = mtFiles.length;

// --- 7. Honesty contract for new evaluator API ------------------------------
//
// The aggregator and assessment depend on TestResult carrying noEvidence /
// countsTowardScore / failureOrigin / honestyFlags. Refuse to release if the
// type or evaluator paths drop those fields.
const typesPath = path.join(ROOT, "engine", "types.ts");
const typesSrc = fs.readFileSync(typesPath, "utf8");
for (const field of ["noEvidence?", "failureOrigin?", "countsTowardScore?", "honestyFlags?", "multiTurnAggregation?", "noPayloadExpected?", "probeType?", "expectedEvidence?"]) {
  if (!typesSrc.includes(field)) {
    record("error", "TYPE_CONTRACT_REGRESSED", `TestCase/TestResult lost field '${field}'. Trust metadata cannot flow through reports.`);
  }
}

// --- 6. Output ---------------------------------------------------------------

function fmt(level, items) {
  if (items.length === 0) return "  none\n";
  return items.map((item) => `  [${level}] ${item.code}: ${item.message}`).join("\n") + "\n";
}

const output = `verum diagnostic — ${new Date().toISOString()}

Test pack:
  totalTests:                ${summary.totalTests}
  productionTestIds:         ${summary.productionTestIds}
  duplicateIds:              ${summary.duplicateIds}
  duplicatePrompts:          ${summary.duplicatePrompts}
  missingPrompts:            ${summary.missingPrompts}
  missingCriteria:           ${summary.missingCriteria}
  missingCategory:           ${summary.missingCategory}
  invalidCategory:           ${summary.invalidCategory}
  missingSeverity:           ${summary.missingSeverity}
  emptyStepCount:            ${summary.emptyStepCount}
  vestigialEmptySteps:       ${summary.vestigialEmptySteps}
  unannotatedNoPayload:      ${summary.unannotatedNoPayload}
  fuzzMisconfigured:         ${summary.fuzzMisconfigured}
  mockDemoCount:             ${summary.mockDemoCount}
  multiTurnTests:            ${summary.multiTurnTests}

Evaluator:
  paraphraseLeakList:        ${summary.evaluatorHasParaphraseList}
  noEvidenceGate:            ${summary.evaluatorHasNoEvidenceGate}
  multiTurnAggregatorWired:  ${summary.multiTurnAggregatorWired}

Assessment / scoring:
  inconclusiveField:         ${summary.assessmentHasInconclusiveField}

Bridge / INDEX.jsonl:
  entries:                   ${summary.bridgeIndexEntries}
  allInconclusivePassed:     ${summary.bridgeAllInconclusivePassed}

Ledger:
  unknownProvider (CURRENT, actionable):    ${summary.unknownProviderCurrent}
  unknownProvider (historical, informational): ${summary.unknownProviderHistorical}

Errors:
${fmt("error", findings)}
Warnings:
${fmt("warning", warnings)}`;

console.log(output);

if (findings.length > 0) {
  console.log(`\nFAIL — ${findings.length} trust-blocking issue(s) detected. Verum is NOT release ready.`);
  process.exit(1);
}

console.log(`\nOK — no trust-blocking issues detected.`);
process.exit(0);
