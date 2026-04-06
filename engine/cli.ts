import path from "path";
import fs from "fs-extra";
import { globSync } from "glob";
import chalk from "chalk";
import { loadTargets, loadTest, resolveTarget, setActiveTarget, addTarget, removeTarget } from "./loaders";
import { sendChat, sendRequest } from "./client";
import { evaluate, evaluateEndpoint } from "./evaluator";
import { generateFuzzPayloads } from "./fuzzer";
import { writeAssessmentBundle, writeReport, writeSuiteSummary, writeTransparencyReport } from "./reportWriter";
import { TestCase, TestResult, TargetConfig } from "./types";
import { recordEntry, getLedgerSummary, getSessionLedger, computeSummary, LedgerEntry } from "./ledger";
import { handleLearningCommand } from "../learning/cli";

const USAGE = `
${chalk.bold("Krakzen")} — adversarial validation framework

${chalk.cyan("Core Commands:")}

  ${chalk.white("run <test-id>")}                Run a single test by ID
  ${chalk.white("suite <category>")}             Run all tests in a category
  ${chalk.white("suite all")}                    Run every test across all categories
  ${chalk.white("suite baseline")}               Run locked baseline suite with threshold gate
  ${chalk.white("list [category]")}              List available test IDs
  ${chalk.white("report latest")}                List latest report files
  ${chalk.white("report summary")}               Show latest suite summary
  ${chalk.white("report transparency")}          Show transparency ledger summary

${chalk.cyan("Target Management:")}

  ${chalk.white("target")}                       Show the active target
  ${chalk.white("target list")}                  List all configured targets
  ${chalk.white("target set <key>")}             Switch the active target
  ${chalk.white("target add <key> <url>")}       Add a new target
  ${chalk.white("target remove <key>")}          Remove a target
  ${chalk.white("target probe [key]")}           Test connectivity to a target

${chalk.cyan("Target Override:")}

  ${chalk.white("--target <key>")}               Override target for any run/suite command

${chalk.cyan("Test Categories:")}

  ${chalk.white("security")}              Prompt injection, refusal, system prompt protection
  ${chalk.white("reliability")}           Input sanitization, malformed input handling
  ${chalk.white("architecture")}          Receipt validation, field presence
  ${chalk.white("recon")}                 Endpoint discovery, info leak detection
  ${chalk.white("auth")}                  Authentication/authorization verification
  ${chalk.white("exfil")}                 Data exfiltration and leakage testing
  ${chalk.white("child-safety")}          Magister child protection (CRITICAL)
  ${chalk.white("multi-turn")}            Multi-step attack chain testing
  ${chalk.white("fuzzing")}               Automated input mutation testing

${chalk.cyan("Learning Module:")}

  ${chalk.white("realm")}                 Enter the Lost City of Atlantis
  ${chalk.white("realm status")}          View level, XP, and zone progress
  ${chalk.white("realm zone <id>")}       Enter a zone and face its creatures
  ${chalk.white("learn")}                 List curriculum modules
  ${chalk.white("learn <module-id>")}     Study a module and take its quiz

${chalk.cyan("Examples:")}

  npm run dev -- run gateway-refusal-basic
  npm run dev -- run gateway-refusal-basic --target squidley-lite
  npm run dev -- suite security --target more-input
  npm run dev -- target set squidley-lite
  npm run dev -- target add squidley-lite http://192.168.1.100:8080
  npm run dev -- target add more-input http://10.0.0.50:9000 --chat /api/chat --format input
  npm run dev -- target probe
  npm run dev -- suite all
  npm run dev -- list
`;

// --- Parse --target flag and other flags from argv ---

type ParsedArgs = {
  command: string;
  arg: string | undefined;
  restArgs: string[];
  targetOverride: string | undefined;
  chatPath: string | undefined;
  payloadFormat: string | undefined;
  notes: string | undefined;
};

function parseArgs(): ParsedArgs {
  const raw = process.argv.slice(2);
  let targetOverride: string | undefined;
  let chatPath: string | undefined;
  let payloadFormat: string | undefined;
  let notes: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "--target" && i + 1 < raw.length) {
      targetOverride = raw[++i];
    } else if (raw[i] === "--chat" && i + 1 < raw.length) {
      chatPath = raw[++i];
    } else if (raw[i] === "--format" && i + 1 < raw.length) {
      payloadFormat = raw[++i];
    } else if (raw[i] === "--notes" && i + 1 < raw.length) {
      notes = raw[++i];
    } else {
      positional.push(raw[i]);
    }
  }

  return {
    command: positional[0] ?? "",
    arg: positional[1],
    restArgs: positional.slice(2),
    targetOverride,
    chatPath,
    payloadFormat,
    notes,
  };
}

// --- Active target state (set once at startup, used by all runners) ---

let activeTargetKey = "";
let activeTarget: TargetConfig | null = null;

async function initTarget(overrideKey?: string): Promise<void> {
  const resolved = await resolveTarget(overrideKey);
  activeTargetKey = resolved.key;
  activeTarget = resolved.target;

  console.log(chalk.gray(`  target: ${activeTarget.name} (${activeTargetKey}) -> ${activeTarget.baseUrl}`));
}

function getTarget(): TargetConfig {
  if (!activeTarget) {
    throw new Error("Target not initialized. Call initTarget() first.");
  }
  return activeTarget;
}

// --- Test registry: maps test ID (filename without .json) to absolute path ---

type TestRegistryEntry = { id: string; filePath: string; test: TestCase };

async function buildRegistry(category?: string): Promise<TestRegistryEntry[]> {
  const baseDir = path.join(process.cwd(), "tests");
  const pattern = category
    ? path.join(baseDir, category, "*.json")
    : path.join(baseDir, "**", "*.json");

  const files = globSync(pattern).sort();
  const entries: TestRegistryEntry[] = [];

  for (const filePath of files) {
    const id = path.basename(filePath, ".json");
    try {
      const test = await loadTest(filePath);
      entries.push({ id, filePath, test });
    } catch {
      // skip unparseable files
    }
  }

  return entries;
}

async function resolveTestPath(testId: string): Promise<string> {
  const registry = await buildRegistry();
  const match = registry.find((e) => e.id === testId);

  if (match) return match.filePath;

  // Fuzzy: check if testId is a substring of any ID
  const fuzzy = registry.filter((e) => e.id.includes(testId));
  if (fuzzy.length === 1) return fuzzy[0].filePath;

  if (fuzzy.length > 1) {
    const ids = fuzzy.map((e) => e.id).join(", ");
    throw new Error(`Ambiguous test ID '${testId}'. Matches: ${ids}`);
  }

  const available = registry.map((e) => e.id).join("\n  ");
  throw new Error(`Unknown test ID '${testId}'. Available tests:\n  ${available}`);
}

// --- Output helpers ---

function resultColor(r: "PASS" | "FAIL" | "WARN"): chalk.Chalk {
  return r === "PASS" ? chalk.green : r === "FAIL" ? chalk.red : chalk.yellow;
}

function printResult(result: TestResult): void {
  const color = resultColor(result.result);
  console.log(color(`  [${result.result}] ${result.testName}`));
  console.log(chalk.gray(`         ${result.observedBehavior.slice(0, 140)}`));
  if (result.retry.attempted) {
    console.log(chalk.gray(`         [retried: ${result.retry.originalError}]`));
  }
}

function printRawResponse(result: TestResult): void {
  console.log(chalk.cyan(`\n  --- Raw Response ---`));
  console.log(result.rawResponseSnippet || chalk.gray("  (empty)"));
  console.log(chalk.cyan(`  --- End Raw Response ---\n`));
}

function buildLedgerEntry(result: TestResult, targetKey: string, endpoint: string, method: string): LedgerEntry {
  const pf = result.parsedFields;
  return {
    id: `${Date.now()}-${result.testId}`,
    timestamp: result.timestamp,
    testId: result.testId,
    target: targetKey,
    endpoint,
    method,
    model: pf.model ?? pf.activeModel,
    provider: pf.provider,
    tokensIn: (result as unknown as Record<string, unknown>).tokensIn as number | undefined,
    tokensOut: (result as unknown as Record<string, unknown>).tokensOut as number | undefined,
    estimatedCostUsd: (result as unknown as Record<string, unknown>).estimatedCostUsd as number | undefined,
    durationMs: result.durationMs,
    serverDurationMs: (result as unknown as Record<string, unknown>).serverDurationMs as number | undefined,
    tier: pf.tier,
    receiptId: pf.receiptId,
    modelRole: undefined,
    escalated: pf.escalated,
    httpStatus: pf.httpStatus,
    result: result.result,
    gatewayBlocked: pf.gatewayBlock,
  };
}

async function recordResultToLedger(result: TestResult, endpoint: string, method: string): Promise<void> {
  const entry = buildLedgerEntry(result, activeTargetKey, endpoint, method);
  await recordEntry(entry);
}

function printSuiteSummary(results: TestResult[]): void {
  const pass = results.filter((r) => r.result === "PASS").length;
  const fail = results.filter((r) => r.result === "FAIL").length;
  const warn = results.filter((r) => r.result === "WARN").length;

  console.log("");
  console.log(chalk.bold("  Summary:"));
  console.log(`    ${chalk.green(`PASS: ${pass}`)}  ${chalk.red(`FAIL: ${fail}`)}  ${chalk.yellow(`WARN: ${warn}`)}  Total: ${results.length}`);

  // Transparency summary from session ledger
  const sessionEntries = getSessionLedger();
  if (sessionEntries.length > 0) {
    const summary = computeSummary(sessionEntries);

    const modelParts: string[] = [];
    for (const [model, data] of Object.entries(summary.modelBreakdown)) {
      modelParts.push(`${model} (${data.count} requests)`);
    }

    console.log("");
    console.log(chalk.bold("  Transparency:"));
    console.log(`    Models:   ${modelParts.length > 0 ? modelParts.join(", ") : "—"}`);
    console.log(`    Tokens:   ${summary.totalTokensIn.toLocaleString()} in / ${summary.totalTokensOut.toLocaleString()} out`);
    console.log(`    Cost:     $${summary.totalEstimatedCostUsd.toFixed(4)}`);
    console.log(`    Duration: ${(summary.totalDurationMs / 1000).toFixed(1)}s total`);
  }

  console.log("");
}

async function refreshAssessmentArtifacts(results?: TestResult[]): Promise<void> {
  await writeAssessmentBundle({
    target: activeTargetKey,
    targetName: getTarget().name,
    targetConfig: getTarget(),
    results,
  });
}

// --- Core commands (all use activeTarget instead of test.target) ---

async function runSingle(testPath: string, showRaw = false): Promise<TestResult | TestResult[]> {
  const testCase = await loadTest(testPath);
  const target = getTarget();

  // Override the test's target field with the active target key
  testCase.target = activeTargetKey;

  // --- Multi-turn tests ---
  if (testCase.steps && testCase.steps.length > 0) {
    return runMultiTurn(testCase, target, showRaw);
  }

  // --- Fuzzing tests ---
  if (testCase.fuzzConfig) {
    return runFuzz(testCase, target, showRaw);
  }

  // --- Endpoint tests (non-chat, or non-POST methods on /chat) ---
  if (testCase.endpoint && testCase.endpoint !== "/chat") {
    return runEndpointTest(testCase, target, showRaw);
  }

  if (testCase.endpoint === "/chat" && testCase.method && testCase.method !== "POST") {
    return runEndpointTest(testCase, target, showRaw);
  }

  // --- Chat endpoint tests (POST /chat with custom input or body) ---
  if (testCase.endpoint === "/chat" && testCase.method === "POST") {
    return runChatEndpointTest(testCase, target, showRaw);
  }

  // --- Standard chat tests (original behavior) ---
  console.log(chalk.cyan(`\n[krakzen] Running: ${testCase.name}`));
  console.log(chalk.gray(`  target: ${target.name} -> ${target.baseUrl}${target.chatPath || "/chat"}`));

  const chat = await sendChat(target, testCase.input);
  const result = evaluate(testCase, chat);

  await writeReport(result);
  await refreshAssessmentArtifacts();
  await recordResultToLedger(result, target.chatPath || "/chat", "POST");
  printResult(result);

  if (showRaw) {
    printRawResponse(result);
  }

  return result;
}

async function runEndpointTest(
  testCase: TestCase,
  target: TargetConfig,
  showRaw: boolean
): Promise<TestResult> {
  const endpoint = testCase.endpoint!;
  const method = testCase.method ?? "GET";

  console.log(chalk.cyan(`\n[krakzen] Running: ${testCase.name}`));
  console.log(chalk.gray(`  target: ${target.name} -> ${method} ${target.baseUrl}${endpoint}`));

  const response = await sendRequest(
    target.baseUrl,
    endpoint,
    method,
    testCase.body,
    testCase.headers
  );

  const result = evaluateEndpoint(testCase, response);
  await writeReport(result);
  await refreshAssessmentArtifacts();
  await recordResultToLedger(result, endpoint, method);
  printResult(result);

  if (showRaw) {
    printRawResponse(result);
  }

  return result;
}

async function runChatEndpointTest(
  testCase: TestCase,
  target: TargetConfig,
  showRaw: boolean
): Promise<TestResult> {
  console.log(chalk.cyan(`\n[krakzen] Running: ${testCase.name}`));
  console.log(chalk.gray(`  target: ${target.name} -> POST ${target.baseUrl}/chat`));

  const chat = await sendChat(target, testCase.input);

  const hasEndpointAssertions = testCase.expectedBehavior.shouldNotExposeInternals ||
    testCase.expectedBehavior.shouldBlockHarmfulContent ||
    testCase.expectedBehavior.shouldEnforceAgeAppropriate ||
    testCase.expectedBehavior.shouldProtectMinorPII;

  let result: TestResult;
  if (hasEndpointAssertions) {
    const endpointResult = {
      ok: chat.ok,
      status: chat.status,
      headers: chat.response.headers,
      data: chat.data,
      rawText: chat.receipt?.output || chat.rawText,
      durationMs: chat.durationMs,
      retry: chat.retry,
      request: chat.request,
      response: chat.response,
    };
    result = evaluateEndpoint(testCase, endpointResult);
  } else {
    result = evaluate(testCase, chat);
  }

  await writeReport(result);
  await refreshAssessmentArtifacts();
  await recordResultToLedger(result, "/chat", "POST");
  printResult(result);

  if (showRaw) {
    printRawResponse(result);
  }

  return result;
}

async function runMultiTurn(
  testCase: TestCase,
  target: TargetConfig,
  showRaw: boolean
): Promise<TestResult[]> {
  console.log(chalk.cyan(`\n[krakzen] Running multi-turn: ${testCase.name}`));
  console.log(chalk.gray(`  target: ${target.name} -> ${testCase.steps!.length} steps`));

  const results: TestResult[] = [];

  for (let i = 0; i < testCase.steps!.length; i++) {
    const step = testCase.steps![i];
    const stepId = `${testCase.id}-step-${i + 1}`;

    console.log(chalk.gray(`\n  Step ${i + 1}/${testCase.steps!.length}: ${step.description}`));

    const stepCase: TestCase = {
      id: stepId,
      name: `${testCase.name} — Step ${i + 1}`,
      category: testCase.category,
      target: activeTargetKey,
      purpose: step.description,
      input: step.input,
      expectedBehavior: step.expectedBehavior,
      severity: testCase.severity,
      endpoint: step.endpoint,
      method: step.method,
      body: step.body,
    };

    let result: TestResult;

    if (step.endpoint && step.endpoint !== "/chat") {
      const response = await sendRequest(
        target.baseUrl,
        step.endpoint,
        step.method ?? "GET",
        step.body
      );
      result = evaluateEndpoint(stepCase, response);
    } else {
      const chat = await sendChat(target, step.input);

      const hasEndpointAssertions = step.expectedBehavior.shouldEnforceAgeAppropriate ||
        step.expectedBehavior.shouldProtectMinorPII ||
        step.expectedBehavior.shouldBlockHarmfulContent;

      if (hasEndpointAssertions) {
        const endpointResult = {
          ok: chat.ok,
          status: chat.status,
          headers: chat.response.headers,
          data: chat.data,
          rawText: chat.receipt?.output || chat.rawText,
          durationMs: chat.durationMs,
          retry: chat.retry,
          request: chat.request,
          response: chat.response,
        };
        result = evaluateEndpoint(stepCase, endpointResult);
      } else {
        result = evaluate(stepCase, chat);
      }
    }

    await writeReport(result);
    const stepEndpoint = step.endpoint ?? target.chatPath ?? "/chat";
    const stepMethod = step.method ?? (step.endpoint && step.endpoint !== "/chat" ? "GET" : "POST");
    await recordResultToLedger(result, stepEndpoint, stepMethod);
    printResult(result);
    results.push(result);

    if (showRaw) {
      printRawResponse(result);
    }
  }

  const pass = results.filter((r) => r.result === "PASS").length;
  const fail = results.filter((r) => r.result === "FAIL").length;
  const warn = results.filter((r) => r.result === "WARN").length;
  const overall = fail > 0 ? chalk.red("FAIL") : warn > 0 ? chalk.yellow("WARN") : chalk.green("PASS");
  console.log(chalk.bold(`\n  Multi-turn result: ${overall} (${pass}P/${fail}F/${warn}W across ${results.length} steps)`));
  await refreshAssessmentArtifacts();

  return results;
}

async function runFuzz(
  testCase: TestCase,
  target: TargetConfig,
  showRaw: boolean
): Promise<TestResult[]> {
  const config = testCase.fuzzConfig!;

  console.log(chalk.cyan(`\n[krakzen] Running fuzz: ${testCase.name}`));
  console.log(chalk.gray(`  target: ${target.name} -> ${config.iterations} iterations, mutations: ${config.mutations.join(", ")}`));

  const payloads = generateFuzzPayloads(config.baseInput, config.mutations, config.iterations);
  const results: TestResult[] = [];

  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i];
    const fuzzId = `${testCase.id}-fuzz-${i + 1}`;
    const displayPayload = payload.length > 60 ? payload.slice(0, 60) + "..." : payload;

    console.log(chalk.gray(`\n  Fuzz ${i + 1}/${payloads.length}: ${JSON.stringify(displayPayload)}`));

    const fuzzCase: TestCase = {
      id: fuzzId,
      name: `${testCase.name} — Fuzz ${i + 1}`,
      category: testCase.category,
      target: activeTargetKey,
      purpose: `Fuzz iteration ${i + 1} of ${testCase.purpose}`,
      input: payload,
      expectedBehavior: testCase.expectedBehavior,
      severity: testCase.severity,
    };

    const chat = await sendChat(target, payload);
    const result = evaluate(fuzzCase, chat);

    await writeReport(result);
    await recordResultToLedger(result, target.chatPath || "/chat", "POST");
    printResult(result);
    results.push(result);
  }

  const pass = results.filter((r) => r.result === "PASS").length;
  const fail = results.filter((r) => r.result === "FAIL").length;
  const warn = results.filter((r) => r.result === "WARN").length;
  const overall = fail > 0 ? chalk.red("FAIL") : warn > 0 ? chalk.yellow("WARN") : chalk.green("PASS");
  console.log(chalk.bold(`\n  Fuzz result: ${overall} (${pass}P/${fail}F/${warn}W across ${results.length} payloads)`));
  await refreshAssessmentArtifacts();

  return results;
}

async function runById(testId: string, showRaw = false): Promise<TestResult | TestResult[]> {
  const filePath = await resolveTestPath(testId);
  return runSingle(filePath, showRaw);
}

function flattenResults(result: TestResult | TestResult[]): TestResult[] {
  return Array.isArray(result) ? result : [result];
}

type BaselineManifest = {
  version: string;
  locked: string;
  description: string;
  tests: string[];
  pass_threshold: { PASS: number; WARN: number; FAIL: number };
};

async function runSuite(category: string): Promise<void> {
  if (category === "baseline") {
    await runBaselineSuite();
    return;
  }

  const registry = await buildRegistry(category === "all" ? undefined : category);

  if (!registry.length) {
    throw new Error(`No tests found for suite '${category}'`);
  }

  console.log(chalk.cyan(`\n[krakzen] Running suite: ${category} (${registry.length} tests)`));

  const results: TestResult[] = [];
  for (const entry of registry) {
    const result = await runSingle(entry.filePath);
    results.push(...flattenResults(result));
  }

  printSuiteSummary(results);
  await writeSuiteSummary(results);
  await refreshAssessmentArtifacts(results);

  const sessionEntries = getSessionLedger();
  if (sessionEntries.length > 0) {
    const summary = computeSummary(sessionEntries);
    await writeTransparencyReport(summary, sessionEntries);
  }

  console.log(chalk.gray("  Suite summary written to reports/latest/SUMMARY.md"));
  console.log(chalk.gray("  Transparency report written to reports/latest/TRANSPARENCY.md"));
}

async function runBaselineSuite(): Promise<void> {
  const manifestPath = path.join(process.cwd(), "tests", "baseline", "manifest.json");
  if (!(await fs.pathExists(manifestPath))) {
    throw new Error("Baseline manifest not found at tests/baseline/manifest.json");
  }

  const manifest = (await fs.readJson(manifestPath)) as BaselineManifest;
  const registry = await buildRegistry();

  console.log(chalk.cyan(`\n[krakzen] Running baseline suite v${manifest.version} (locked ${manifest.locked})`));
  console.log(chalk.gray(`  ${manifest.description}`));
  console.log(chalk.gray(`  Threshold: PASS>=${manifest.pass_threshold.PASS}, WARN<=${manifest.pass_threshold.WARN}, FAIL<=${manifest.pass_threshold.FAIL}\n`));

  const results: TestResult[] = [];
  const missing: string[] = [];

  for (const testId of manifest.tests) {
    const entry = registry.find((e) => e.id === testId);
    if (!entry) {
      missing.push(testId);
      continue;
    }
    const result = await runSingle(entry.filePath);
    results.push(...flattenResults(result));
  }

  if (missing.length) {
    console.log(chalk.yellow(`\n  Missing tests: ${missing.join(", ")}`));
  }

  const pass = results.filter((r) => r.result === "PASS").length;
  const fail = results.filter((r) => r.result === "FAIL").length;
  const warn = results.filter((r) => r.result === "WARN").length;

  printSuiteSummary(results);
  await writeSuiteSummary(results);
  await refreshAssessmentArtifacts(results);

  const passOk = pass >= manifest.pass_threshold.PASS;
  const warnOk = warn <= manifest.pass_threshold.WARN;
  const failOk = fail <= manifest.pass_threshold.FAIL;
  const gatePass = passOk && warnOk && failOk;

  console.log(chalk.bold("  Baseline Gate:"));
  console.log(`    PASS ${pass}>=${manifest.pass_threshold.PASS}: ${passOk ? chalk.green("OK") : chalk.red("FAIL")}`);
  console.log(`    WARN ${warn}<=${manifest.pass_threshold.WARN}: ${warnOk ? chalk.green("OK") : chalk.red("FAIL")}`);
  console.log(`    FAIL ${fail}<=${manifest.pass_threshold.FAIL}: ${failOk ? chalk.green("OK") : chalk.red("FAIL")}`);
  console.log("");

  if (gatePass) {
    console.log(chalk.green.bold("  BASELINE GATE: PASSED"));
  } else {
    console.log(chalk.red.bold("  BASELINE GATE: FAILED"));
    process.exit(1);
  }
}

async function listTests(category?: string): Promise<void> {
  const registry = await buildRegistry(category);

  if (!registry.length) {
    console.log(chalk.yellow("No tests found."));
    return;
  }

  console.log(chalk.cyan(`\n[krakzen] Available tests${category ? ` (${category})` : ""}:\n`));

  const byCategory = new Map<string, TestRegistryEntry[]>();
  for (const entry of registry) {
    const cat = entry.test.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(entry);
  }

  for (const [cat, entries] of byCategory) {
    console.log(chalk.white(`  ${cat}/`));
    for (const entry of entries) {
      console.log(`    ${chalk.green(entry.id)}`);
      console.log(chalk.gray(`      ${entry.test.purpose}`));
    }
    console.log("");
  }
}

async function reportLatest(): Promise<void> {
  const dir = path.join(process.cwd(), "reports", "latest");
  const files = (await fs.readdir(dir)).filter((x) => x.endsWith(".md") || x.endsWith(".json"));

  console.log(chalk.cyan("\n[krakzen] Latest reports:\n"));
  for (const file of files.sort()) {
    console.log(`  ${file}`);
  }
  console.log("");
}

async function reportTransparency(): Promise<void> {
  const summary = await getLedgerSummary();

  if (summary.totalRequests === 0) {
    console.log(chalk.yellow("No ledger entries found. Run some tests first."));
    return;
  }

  console.log(chalk.cyan("\n[krakzen] Transparency Ledger Summary\n"));
  console.log(`  Total Requests:  ${summary.totalRequests}`);
  console.log(`  Tokens In:       ${summary.totalTokensIn.toLocaleString()}`);
  console.log(`  Tokens Out:      ${summary.totalTokensOut.toLocaleString()}`);
  console.log(`  Estimated Cost:  $${summary.totalEstimatedCostUsd.toFixed(4)}`);
  console.log(`  Total Duration:  ${(summary.totalDurationMs / 1000).toFixed(1)}s`);

  console.log(chalk.bold("\n  Models:"));
  for (const [model, data] of Object.entries(summary.modelBreakdown)) {
    console.log(`    ${model}: ${data.count} requests, ${data.tokensIn}/${data.tokensOut} tokens, $${data.costUsd.toFixed(4)}`);
  }

  console.log(chalk.bold("\n  Providers:"));
  for (const [provider, data] of Object.entries(summary.providerBreakdown)) {
    console.log(`    ${provider}: ${data.count} requests, ${data.tokensIn}/${data.tokensOut} tokens, $${data.costUsd.toFixed(4)}`);
  }

  console.log(chalk.bold("\n  Results:"));
  console.log(`    ${chalk.green(`PASS: ${summary.resultBreakdown.pass}`)}  ${chalk.red(`FAIL: ${summary.resultBreakdown.fail}`)}  ${chalk.yellow(`WARN: ${summary.resultBreakdown.warn}`)}`);

  console.log(chalk.bold("\n  Targets:"));
  for (const [target, count] of Object.entries(summary.targetBreakdown)) {
    console.log(`    ${target}: ${count} requests`);
  }

  console.log("");
}

async function reportSummary(): Promise<void> {
  const summaryPath = path.join(process.cwd(), "reports", "latest", "SUMMARY.md");

  if (!(await fs.pathExists(summaryPath))) {
    console.log(chalk.yellow("No summary found. Run a suite first."));
    return;
  }

  const content = await fs.readFile(summaryPath, "utf8");
  console.log(content);
}

// --- Target management commands ---

async function handleTargetCommand(args: ParsedArgs): Promise<void> {
  const sub = args.arg;

  if (!sub) {
    // Show active target
    const data = await loadTargets();
    const key = data.defaultTarget;
    const t = data.targets[key];
    if (!t) {
      console.log(chalk.yellow(`Active target '${key}' not found in config.`));
      return;
    }
    console.log(chalk.cyan(`\n[krakzen] Active target:\n`));
    console.log(`  ${chalk.white.bold(key)}`);
    console.log(`    Name:    ${t.name}`);
    console.log(`    URL:     ${chalk.green(t.baseUrl)}`);
    console.log(`    Chat:    ${t.chatPath}`);
    console.log(`    Format:  ${t.payloadFormat}`);
    if (t.notes) console.log(`    Notes:   ${chalk.gray(t.notes)}`);
    console.log("");
    return;
  }

  switch (sub) {
    case "list": {
      const data = await loadTargets();
      console.log(chalk.cyan(`\n[krakzen] Configured targets:\n`));
      for (const [key, t] of Object.entries(data.targets)) {
        const active = key === data.defaultTarget ? chalk.green(" (active)") : "";
        console.log(`  ${chalk.white.bold(key)}${active}`);
        console.log(`    ${t.name} -> ${chalk.green(t.baseUrl)}${t.chatPath}`);
        if (t.notes) console.log(`    ${chalk.gray(t.notes)}`);
        console.log("");
      }
      break;
    }

    case "set": {
      const key = args.restArgs[0];
      if (!key) throw new Error("Missing target key. Usage: target set <key>");
      const t = await setActiveTarget(key);
      console.log(chalk.green(`\n[krakzen] Active target set to '${key}' -> ${t.baseUrl}\n`));
      break;
    }

    case "add": {
      const key = args.restArgs[0];
      const url = args.restArgs[1];
      if (!key || !url) throw new Error("Missing arguments. Usage: target add <key> <url> [--chat /path] [--format messages|input] [--notes '...']");

      const newTarget: TargetConfig = {
        name: key.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
        baseUrl: url.replace(/\/+$/, ""),
        chatPath: args.chatPath ?? "/chat",
        payloadFormat: (args.payloadFormat === "input" ? "input" : "messages") as "messages" | "input",
        notes: args.notes,
      };

      await addTarget(key, newTarget);
      console.log(chalk.green(`\n[krakzen] Target '${key}' added:`));
      console.log(`  Name:    ${newTarget.name}`);
      console.log(`  URL:     ${newTarget.baseUrl}`);
      console.log(`  Chat:    ${newTarget.chatPath}`);
      console.log(`  Format:  ${newTarget.payloadFormat}`);
      if (newTarget.notes) console.log(`  Notes:   ${newTarget.notes}`);
      console.log(chalk.gray(`\n  Switch to it with: npm run dev -- target set ${key}\n`));
      break;
    }

    case "remove": {
      const key = args.restArgs[0];
      if (!key) throw new Error("Missing target key. Usage: target remove <key>");
      await removeTarget(key);
      console.log(chalk.green(`\n[krakzen] Target '${key}' removed.\n`));
      break;
    }

    case "probe": {
      const key = args.restArgs[0];
      const resolved = await resolveTarget(key);
      await probeTarget(resolved.key, resolved.target);
      break;
    }

    default:
      throw new Error(`Unknown target subcommand '${sub}'. Use: list, set, add, remove, probe`);
  }
}

async function probeTarget(key: string, target: TargetConfig): Promise<void> {
  console.log(chalk.cyan(`\n[krakzen] Probing target: ${target.name} (${key})`));
  console.log(chalk.gray(`  URL: ${target.baseUrl}\n`));

  // Check base connectivity
  const probes = [
    { path: "/", label: "Root" },
    { path: target.chatPath || "/chat", label: "Chat endpoint" },
    { path: "/health", label: "Health" },
    { path: "/version", label: "Version" },
    { path: "/sessions", label: "Sessions" },
    { path: "/runs", label: "Runs" },
    { path: "/tools/list", label: "Tools" },
    { path: "/search?q=test", label: "Search" },
    { path: "/memory/search", label: "Memory" },
    { path: "/magister/modules", label: "Magister" },
  ];

  let reachable = 0;
  let total = 0;

  for (const probe of probes) {
    total++;
    try {
      const result = await sendRequest(target.baseUrl, probe.path, "GET", undefined, undefined, 5000);
      const status = result.status;
      const size = result.rawText.length;
      if (status > 0) {
        reachable++;
        const color = status >= 200 && status < 300 ? chalk.green : status === 404 ? chalk.gray : chalk.yellow;
        console.log(`  ${color(`${status}`)}  ${probe.label.padEnd(16)} ${probe.path}  ${chalk.gray(`(${size} bytes)`)}`);
      } else {
        console.log(`  ${chalk.red("---")}  ${probe.label.padEnd(16)} ${probe.path}  ${chalk.red("unreachable")}`);
      }
    } catch {
      console.log(`  ${chalk.red("ERR")}  ${probe.label.padEnd(16)} ${probe.path}  ${chalk.red("error")}`);
    }
  }

  console.log("");
  if (reachable === 0) {
    console.log(chalk.red(`  Target is unreachable at ${target.baseUrl}`));
  } else {
    console.log(chalk.green(`  ${reachable}/${total} endpoints responded.`));
  }
  console.log("");
}

// --- Main ---

async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.command) {
    console.log(USAGE);
    process.exit(1);
  }

  // Handle target management commands (no target init needed)
  if (args.command === "target") {
    await handleTargetCommand(args);
    return;
  }

  // Check learning module commands first (realm, learn)
  const restArgsStr = process.argv.slice(3).filter((a) => !a.startsWith("--")).join(" ") || undefined;
  const handled = await handleLearningCommand(args.command, restArgsStr);
  if (handled) return;

  // For run/suite commands, init the target
  if (args.command === "run" || args.command === "suite") {
    await initTarget(args.targetOverride);
  }

  switch (args.command) {
    case "run":
      if (!args.arg) throw new Error("Missing test ID. Run 'list' to see available tests.");
      await runById(args.arg, true);
      break;

    case "suite":
      if (!args.arg) throw new Error("Missing suite name (security, reliability, architecture, all)");
      await runSuite(args.arg);
      break;

    case "list":
      await listTests(args.arg);
      break;

    case "report":
      if (args.arg === "summary") {
        await reportSummary();
      } else if (args.arg === "transparency") {
        await reportTransparency();
      } else {
        await reportLatest();
      }
      break;

    default:
      console.log(chalk.red(`Unknown command '${args.command}'`));
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(chalk.red("[krakzen] Error:"), error instanceof Error ? error.message : error);
  process.exit(1);
});
