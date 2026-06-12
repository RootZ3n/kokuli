// engine/validation.ts
//
// Semantic validation for Kokuli test definitions.
//
// `loadTest` only does a JSON.parse — it returns whatever shape the file
// happens to have. CLI/server filter on `name && category` and otherwise
// trust the file. That lets the following slip through unnoticed:
//   - tests with empty / placeholder input prompts
//   - tests with no expected behavior at all (always WARN, never grades)
//   - tests with severity strings that aren't in the allowed set
//   - duplicate IDs across files (one shadows the other silently)
//   - mock/demo tests masquerading as production
//   - multi-turn tests with zero steps
//   - tool-required tests when tools aren't available
//   - fuzz tests with iterations <= 0
//
// This module is consumed by:
//   * scripts/kokuli-diagnostic.mjs (release gate)
//   * engine/cli.ts (registry filter — only validated tests enter score math)
//   * server/api.ts (refuses to register invalid tests in the UI)
//   * engine/validation.test.ts (regression coverage)

import path from "path";
import fs from "fs-extra";
import { globSync } from "glob";
import type { Severity, TestCase } from "./types";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  testId: string;
  filePath: string;
  severity: ValidationSeverity;
  code: string;
  message: string;
}

export interface ValidationReport {
  total: number;
  validCount: number;
  errorCount: number;
  warningCount: number;
  issues: ValidationIssue[];
  duplicates: Array<{ id: string; files: string[] }>;
  duplicatePrompts: Array<{ digest: string; ids: string[] }>;
  mockOrDemo: string[];
  /** Tests that have valid shape and may be executed for score. */
  productionTestIds: string[];
}

export const VALID_SEVERITIES: ReadonlyArray<Severity> = ["low", "medium", "high", "critical"];

export const VALID_CATEGORIES: ReadonlyArray<string> = [
  "security",
  "reliability",
  "architecture",
  "recon",
  "auth",
  "exfil",
  "child-safety",
  "multi-turn",
  "fuzzing",
  "baseline",
];

export const VALID_PROBE_TYPES: ReadonlyArray<string> = [
  "recon",
  "auth",
  "availability",
  "header",
  "method-confusion",
  "endpoint-presence",
  "exfil-endpoint",
  "architecture",
];

export const VALID_AGGREGATION_MODES: ReadonlyArray<string> = [
  "all_turns",
  "final_turn",
  "escalation_pattern",
  "consistency",
  "leakage",
  "custom",
];

export const VALID_TURN_EVIDENCE_KINDS: ReadonlyArray<string> = [
  "content_returned",
  "refusal",
  "no_leak",
  "gateway_block",
  "any_response",
];

const MOCK_DEMO_HINTS = [
  /\bmock\b/i,
  /\bdemo\b/i,
  /\bfixture\b/i,
  /\bsample\b/i,
  /\bplaceholder\b/i,
  /\bTODO\b/,
  /\bFIXME\b/,
];

const TRIVIAL_PROMPTS = new Set([
  "",
  "string",
  "test",
  "todo",
  "placeholder",
  "example",
  "hello world",
]);

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

function isNonEmptyArray<T = unknown>(value: unknown): value is T[] {
  return Array.isArray(value) && value.length > 0;
}

function hasAnyExpectedBehavior(t: TestCase): boolean {
  const eb = t.expectedBehavior || {};
  return Object.values(eb).some((value) => value !== undefined && value !== null);
}

function looksLikeMockOrDemo(t: TestCase): boolean {
  const haystack = `${t.id ?? ""} ${t.name ?? ""} ${t.purpose ?? ""} ${t.input ?? ""}`;
  return MOCK_DEMO_HINTS.some((pattern) => pattern.test(haystack));
}

function looksLikeTrivialPrompt(input: string | undefined): boolean {
  const value = (input ?? "").trim().toLowerCase();
  if (TRIVIAL_PROMPTS.has(value)) return true;
  if (value.length < 8) return true;
  return false;
}

function promptDigest(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .slice(0, 200);
}

interface LoadedTest {
  id: string;
  filePath: string;
  raw: TestCase;
}

async function loadAll(testsRoot: string): Promise<LoadedTest[]> {
  const pattern = path.join(testsRoot, "**", "*.json");
  const files = globSync(pattern).sort();
  const out: LoadedTest[] = [];
  for (const filePath of files) {
    // baseline/manifest.json is configuration, not a test
    if (filePath.endsWith(path.join("baseline", "manifest.json"))) continue;
    try {
      const raw = (await fs.readJson(filePath)) as TestCase;
      // Tests without name or category are not test definitions (they may be
      // suite manifests). Match the registry filter in cli.ts/server/api.ts.
      if (!raw || typeof raw !== "object") continue;
      if (!raw.name || !raw.category) continue;
      out.push({
        id: path.basename(filePath, ".json"),
        filePath,
        raw,
      });
    } catch {
      // unparseable JSON — surfaced as a validation error below
      out.push({
        id: path.basename(filePath, ".json"),
        filePath,
        raw: { id: "", name: "", category: "", target: "", purpose: "", input: "", expectedBehavior: {}, severity: "low" } as TestCase,
      });
    }
  }
  return out;
}

/**
 * Validate a single test in isolation. Cross-file checks (duplicate IDs,
 * near-duplicate prompts) live in {@link validateTestPack}.
 */
export function validateTest(test: LoadedTest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { raw, filePath, id } = test;
  const push = (severity: ValidationSeverity, code: string, message: string) => {
    issues.push({ testId: id, filePath, severity, code, message });
  };

  if (!isNonEmptyString(raw.id)) {
    push("error", "MISSING_ID", "test JSON is missing the 'id' field");
  }
  if (!isNonEmptyString(raw.name)) {
    push("error", "MISSING_NAME", "test JSON is missing the 'name' field");
  }
  if (!isNonEmptyString(raw.category)) {
    push("error", "MISSING_CATEGORY", "test JSON is missing the 'category' field");
  } else if (!VALID_CATEGORIES.includes(raw.category)) {
    push("error", "INVALID_CATEGORY", `category '${raw.category}' is not one of: ${VALID_CATEGORIES.join(", ")}`);
  }
  if (!isNonEmptyString(raw.purpose)) {
    push("warning", "MISSING_PURPOSE", "test has no purpose — operators cannot review intent");
  }
  if (!isString(raw.severity) || !VALID_SEVERITIES.includes(raw.severity as Severity)) {
    push("error", "INVALID_SEVERITY", `severity must be one of ${VALID_SEVERITIES.join(", ")} (got ${JSON.stringify(raw.severity)})`);
  }

  // expectedBehavior is required for grading
  if (!hasAnyExpectedBehavior(raw)) {
    push("error", "MISSING_EXPECTED_BEHAVIOR", "expectedBehavior is empty — test cannot be graded deterministically");
  }

  // Multi-turn / fuzz / endpoint shape gating
  const hasSteps = isNonEmptyArray(raw.steps);
  const hasFuzz = !!raw.fuzzConfig;
  const declaresEndpoint = isNonEmptyString(raw.endpoint);
  const isEndpointOnly = declaresEndpoint && raw.endpoint !== "/chat";
  const isChatEndpointTest = declaresEndpoint && raw.endpoint === "/chat";

  if (raw.steps !== undefined && !Array.isArray(raw.steps)) {
    push("error", "INVALID_STEPS", "steps must be an array");
  }
  if (Array.isArray(raw.steps) && raw.steps.length === 0) {
    // A truly empty steps array carries no information. Whether the test
    // exercises an endpoint or not, the empty array is a footgun: it claims
    // multi-turn shape but provides nothing for the multi-turn aggregator
    // to operate on. Delete the field instead of leaving it.
    push("error", "EMPTY_STEPS", "test declares 'steps' as an empty array; either populate it or remove the field");
  }
  if (Array.isArray(raw.steps) && raw.steps.length === 1) {
    push("warning", "SINGLE_STEP_MULTITURN", "multi-turn test has only one step; it will not exercise turn-to-turn escalation");
  }
  if (Array.isArray(raw.steps) && raw.steps.length >= 2) {
    // Multi-turn aggregation metadata is required so the aggregator can
    // produce a real cross-turn verdict instead of falling back to "sum the
    // step verdicts" — which is exactly what produced the audit-failure mode.
    const agg = (raw as { multiTurnAggregation?: { mode?: string; requiredTurnEvidence?: unknown[] } }).multiTurnAggregation;
    if (!agg || !agg.mode) {
      push("error", "MISSING_MULTITURN_AGGREGATION", `multi-turn test must declare multiTurnAggregation.mode (one of ${VALID_AGGREGATION_MODES.join(", ")})`);
    } else if (!VALID_AGGREGATION_MODES.includes(agg.mode)) {
      push("error", "INVALID_AGGREGATION_MODE", `multiTurnAggregation.mode '${agg.mode}' is not one of ${VALID_AGGREGATION_MODES.join(", ")}`);
    } else if (agg.mode === "custom") {
      if (!isNonEmptyArray(agg.requiredTurnEvidence)) {
        push("error", "MISSING_REQUIRED_TURN_EVIDENCE", "multiTurnAggregation.mode='custom' requires a non-empty requiredTurnEvidence array");
      } else {
        for (const entry of agg.requiredTurnEvidence as Array<{ turn?: unknown; kind?: unknown }>) {
          if (typeof entry !== "object" || entry === null) {
            push("error", "INVALID_TURN_EVIDENCE", "requiredTurnEvidence entry is not an object");
            continue;
          }
          if (typeof entry.turn !== "number" || !Number.isInteger(entry.turn)) {
            push("error", "INVALID_TURN_EVIDENCE", "requiredTurnEvidence entry must have integer 'turn'");
          }
          if (typeof entry.kind !== "string" || !VALID_TURN_EVIDENCE_KINDS.includes(entry.kind)) {
            push("error", "INVALID_TURN_EVIDENCE", `requiredTurnEvidence.kind must be one of ${VALID_TURN_EVIDENCE_KINDS.join(", ")}`);
          }
        }
      }
    }
  }
  if (Array.isArray(raw.steps)) {
    for (let i = 0; i < raw.steps.length; i++) {
      const step = raw.steps[i];
      if (!step || typeof step !== "object") {
        push("error", "INVALID_STEP", `step ${i + 1} is not an object`);
        continue;
      }
      if (!isString(step.input) && !isString(step.endpoint)) {
        push("error", "STEP_NO_PAYLOAD", `step ${i + 1} has no 'input' or 'endpoint'`);
      }
      if (!step.expectedBehavior || Object.keys(step.expectedBehavior).length === 0) {
        push("warning", "STEP_NO_EXPECTED", `step ${i + 1} has no expectedBehavior — that step cannot be graded`);
      }
    }
  }

  if (hasFuzz) {
    const fc = raw.fuzzConfig!;
    if (!isNonEmptyString(fc.baseInput)) {
      push("error", "FUZZ_NO_BASE_INPUT", "fuzzConfig.baseInput is empty");
    }
    if (!isNonEmptyArray(fc.mutations)) {
      push("error", "FUZZ_NO_MUTATIONS", "fuzzConfig.mutations must list at least one mutation");
    }
    if (typeof fc.iterations !== "number" || !Number.isFinite(fc.iterations) || fc.iterations <= 0) {
      push("error", "FUZZ_BAD_ITERATIONS", "fuzzConfig.iterations must be a positive number");
    }
  }

  // Input/endpoint contract:
  //   - pure chat tests (no endpoint at all) need a non-trivial input unless
  //     they are multi-turn (steps cover the inputs)
  //   - endpoint tests (endpoint set to anything, including /chat) exercise
  //     transport/headers/body — empty or short input is OK because the
  //     test surface is the request shape, not the chat prompt
  //   - fuzz tests carry input via fuzzConfig.baseInput
  const isPureChatTest = !declaresEndpoint && !hasFuzz && !hasSteps;
  if (isPureChatTest) {
    if (!isString(raw.input)) {
      push("error", "MISSING_INPUT", "chat test has no 'input' field");
    } else if (looksLikeTrivialPrompt(raw.input)) {
      push("error", "TRIVIAL_INPUT", `chat test prompt is trivial / placeholder ('${(raw.input ?? "").slice(0, 40)}')`);
    }
  } else if (declaresEndpoint && !hasSteps && !hasFuzz) {
    // Endpoint tests with no input, no body, and no custom headers are
    // probing a URL on its own (method + path + auth posture). That can be a
    // legitimate recon/auth probe — but only if the test explicitly declares
    // that intent so a future reader cannot mistake it for a half-finished
    // test. The metadata must be:
    //   noPayloadExpected: true
    //   probeType:        one of VALID_PROBE_TYPES
    //   expectedEvidence: string describing what evidence the URL alone
    //                     proves (e.g. auth posture, status class)
    const noBody = !raw.body;
    const noHeaders = !raw.headers || Object.keys(raw.headers).length === 0;
    const noInput = !isNonEmptyString(raw.input);
    if (noInput && noBody && noHeaders) {
      const meta = raw as { noPayloadExpected?: unknown; probeType?: unknown; expectedEvidence?: unknown };
      const declared = meta.noPayloadExpected === true;
      const probeOk = typeof meta.probeType === "string" && VALID_PROBE_TYPES.includes(meta.probeType);
      const evidenceOk = typeof meta.expectedEvidence === "string" && meta.expectedEvidence.trim().length >= 20;
      if (!declared || !probeOk || !evidenceOk) {
        const missing: string[] = [];
        if (!declared) missing.push("noPayloadExpected:true");
        if (!probeOk) missing.push(`probeType:${VALID_PROBE_TYPES.join("|")}`);
        if (!evidenceOk) missing.push("expectedEvidence:string(>=20 chars)");
        push("error", "ENDPOINT_NO_PAYLOAD_UNANNOTATED", `endpoint test has no input/body/headers and is missing probe metadata: ${missing.join(", ")}`);
      }
    }
  }

  // probeType / noPayloadExpected / expectedEvidence sanity checks for tests
  // that declare them.
  const meta = raw as { noPayloadExpected?: unknown; probeType?: unknown; expectedEvidence?: unknown };
  if (meta.noPayloadExpected !== undefined && typeof meta.noPayloadExpected !== "boolean") {
    push("error", "INVALID_PROBE_METADATA", "noPayloadExpected must be boolean");
  }
  if (meta.probeType !== undefined && (typeof meta.probeType !== "string" || !VALID_PROBE_TYPES.includes(meta.probeType))) {
    push("error", "INVALID_PROBE_TYPE", `probeType must be one of ${VALID_PROBE_TYPES.join(", ")}`);
  }
  if (meta.expectedEvidence !== undefined && (typeof meta.expectedEvidence !== "string" || meta.expectedEvidence.trim().length === 0)) {
    push("error", "INVALID_EXPECTED_EVIDENCE", "expectedEvidence must be a non-empty string");
  }

  // Tool-required tests must declare tool availability or be marked tool_unavailable
  // (Kokuli does not yet wire tool invocations; flag any test whose prompt mentions
  // tool/function calling so the operator can confirm the boundary is exercised.)
  const promptCorpus = `${raw.input ?? ""} ${raw.purpose ?? ""}`.toLowerCase();
  if (/\b(tool[_ -]?call|function[_ -]?call|invoke\s+tool|use\s+the\s+tool)\b/.test(promptCorpus)) {
    push("warning", "TOOL_BOUNDARY_UNVERIFIED", "test mentions tools/function-calling but Kokuli has no tool runner — exercise is unverified");
  }

  // Severity-without-evidence guard: critical tests with no failureCriteria
  if (raw.severity === "critical" && !hasAnyExpectedBehavior(raw)) {
    push("error", "SEVERITY_UNSUPPORTED", "critical severity without any expectedBehavior — severity has no supporting failure rule");
  }

  return issues;
}

/**
 * Validate every test under `testsRoot`. Returns a {@link ValidationReport}
 * with per-test issues plus pack-wide checks (duplicates, near-duplicates).
 */
export async function validateTestPack(testsRoot?: string): Promise<ValidationReport> {
  const root = testsRoot ?? path.join(process.cwd(), "tests");
  const tests = await loadAll(root);

  const issues: ValidationIssue[] = [];

  // Duplicate IDs (collisions across files — only one would survive)
  const byId = new Map<string, string[]>();
  for (const t of tests) {
    const id = (t.raw.id || "").trim() || "<missing>";
    const existing = byId.get(id) ?? [];
    existing.push(t.filePath);
    byId.set(id, existing);
  }
  const duplicates: Array<{ id: string; files: string[] }> = [];
  for (const [id, files] of byId) {
    if (files.length > 1 && id !== "<missing>") {
      duplicates.push({ id, files });
      for (const filePath of files) {
        issues.push({
          testId: path.basename(filePath, ".json"),
          filePath,
          severity: "error",
          code: "DUPLICATE_ID",
          message: `test id '${id}' appears in ${files.length} files`,
        });
      }
    }
  }

  // Near-duplicate prompts (after lowercasing + symbol stripping)
  const byPrompt = new Map<string, string[]>();
  for (const t of tests) {
    const raw = t.raw;
    const text = isString(raw.input) ? raw.input : "";
    if (text.trim().length < 16) continue; // ignore short/empty inputs
    const digest = promptDigest(text);
    if (!digest) continue;
    const existing = byPrompt.get(digest) ?? [];
    existing.push(raw.id || t.id);
    byPrompt.set(digest, existing);
  }
  const duplicatePrompts: Array<{ digest: string; ids: string[] }> = [];
  for (const [digest, ids] of byPrompt) {
    if (ids.length > 1) {
      duplicatePrompts.push({ digest, ids });
      // Surface as warning, not error — sometimes intentional (variants)
      for (const id of ids) {
        issues.push({
          testId: id,
          filePath: "(multiple)",
          severity: "warning",
          code: "DUPLICATE_PROMPT",
          message: `prompt is near-identical across ${ids.length} tests: ${ids.join(", ")}`,
        });
      }
    }
  }

  const mockOrDemo: string[] = [];
  const productionTestIds: string[] = [];

  for (const t of tests) {
    const perTest = validateTest(t);
    issues.push(...perTest);

    const hasErrors = perTest.some((issue) => issue.severity === "error");
    if (looksLikeMockOrDemo(t.raw)) mockOrDemo.push(t.id);
    if (!hasErrors && !looksLikeMockOrDemo(t.raw)) productionTestIds.push(t.id);
  }

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const validCount = tests.length - new Set(issues.filter((issue) => issue.severity === "error").map((issue) => issue.testId)).size;

  return {
    total: tests.length,
    validCount,
    errorCount,
    warningCount,
    issues,
    duplicates,
    duplicatePrompts,
    mockOrDemo,
    productionTestIds,
  };
}
