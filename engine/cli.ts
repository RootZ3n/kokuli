import path from "path";
import fs from "fs-extra";
import { globSync } from "glob";
import chalk from "chalk";
import { loadTargets, loadTest } from "./loaders";
import { sendChat } from "./client";
import { evaluate } from "./evaluator";
import { writeReport, writeSuiteSummary } from "./reportWriter";
import { TestCase, TestResult } from "./types";
import { handleLearningCommand } from "../learning/cli";

const USAGE = `
${chalk.bold("Krakzen")} — adversarial validation framework for Squidley

${chalk.cyan("Core Commands:")}

  ${chalk.white("run <test-id>")}         Run a single test by ID
  ${chalk.white("suite <category>")}      Run all tests in a category (security, reliability, architecture)
  ${chalk.white("suite all")}             Run every test across all categories
  ${chalk.white("suite baseline")}        Run locked baseline suite with threshold gate
  ${chalk.white("list [category]")}       List available test IDs
  ${chalk.white("report latest")}         List latest report files
  ${chalk.white("report summary")}        Show latest suite summary

${chalk.cyan("Learning Module:")}

  ${chalk.white("realm")}                 Enter the Lost City of Atlantis
  ${chalk.white("realm status")}          View level, XP, and zone progress
  ${chalk.white("realm zone <id>")}       Enter a zone and face its creatures
  ${chalk.white("learn")}                 List curriculum modules
  ${chalk.white("learn <module-id>")}     Study a module and take its quiz

${chalk.cyan("Examples:")}

  npm run dev -- run gateway-refusal-basic
  npm run dev -- suite security
  npm run dev -- suite all
  npm run dev -- list
  npm run dev -- realm status
  npm run dev -- learn
`;

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

function printSuiteSummary(results: TestResult[]): void {
  const pass = results.filter((r) => r.result === "PASS").length;
  const fail = results.filter((r) => r.result === "FAIL").length;
  const warn = results.filter((r) => r.result === "WARN").length;

  console.log("");
  console.log(chalk.bold("  Summary:"));
  console.log(`    ${chalk.green(`PASS: ${pass}`)}  ${chalk.red(`FAIL: ${fail}`)}  ${chalk.yellow(`WARN: ${warn}`)}  Total: ${results.length}`);
  console.log("");
}

// --- Core commands ---

async function runSingle(testPath: string, showRaw = false): Promise<TestResult> {
  const testCase = await loadTest(testPath);
  const targetsFile = await loadTargets();
  const target = targetsFile.targets[testCase.target];

  if (!target) {
    throw new Error(
      `Unknown target '${testCase.target}' in test '${testCase.id}'. Available: ${Object.keys(targetsFile.targets).join(", ")}`
    );
  }

  console.log(chalk.cyan(`\n[krakzen] Running: ${testCase.name}`));
  console.log(chalk.gray(`  target: ${target.name} -> ${target.baseUrl}${target.chatPath}`));

  const chat = await sendChat(target, testCase.input);
  const result = evaluate(testCase, chat);

  await writeReport(result);
  printResult(result);

  if (showRaw) {
    printRawResponse(result);
  }

  return result;
}

async function runById(testId: string, showRaw = false): Promise<TestResult> {
  const filePath = await resolveTestPath(testId);
  return runSingle(filePath, showRaw);
}

type BaselineManifest = {
  version: string;
  locked: string;
  description: string;
  tests: string[];
  pass_threshold: { PASS: number; WARN: number; FAIL: number };
};

async function runSuite(category: string): Promise<void> {
  // Handle baseline suite specially
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
    results.push(result);
  }

  printSuiteSummary(results);
  await writeSuiteSummary(results);
  console.log(chalk.gray("  Suite summary written to reports/latest/SUMMARY.md"));
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
    results.push(result);
  }

  if (missing.length) {
    console.log(chalk.yellow(`\n  Missing tests: ${missing.join(", ")}`));
  }

  const pass = results.filter((r) => r.result === "PASS").length;
  const fail = results.filter((r) => r.result === "FAIL").length;
  const warn = results.filter((r) => r.result === "WARN").length;

  printSuiteSummary(results);
  await writeSuiteSummary(results);

  // Threshold check
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

  // Group by category
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

async function reportSummary(): Promise<void> {
  const summaryPath = path.join(process.cwd(), "reports", "latest", "SUMMARY.md");

  if (!(await fs.pathExists(summaryPath))) {
    console.log(chalk.yellow("No summary found. Run a suite first."));
    return;
  }

  const content = await fs.readFile(summaryPath, "utf8");
  console.log(content);
}

// --- Main ---

async function main(): Promise<void> {
  const [, , command, arg] = process.argv;

  if (!command) {
    console.log(USAGE);
    process.exit(1);
  }

  // Check learning module commands first (realm, learn)
  const restArgs = process.argv.slice(3).join(" ") || undefined;
  const handled = await handleLearningCommand(command, restArgs);
  if (handled) return;

  switch (command) {
    case "run":
      if (!arg) throw new Error("Missing test ID. Run 'list' to see available tests.");
      await runById(arg, true);
      break;

    case "suite":
      if (!arg) throw new Error("Missing suite name (security, reliability, architecture, all)");
      await runSuite(arg);
      break;

    case "list":
      await listTests(arg);
      break;

    case "report":
      if (arg === "summary") {
        await reportSummary();
      } else {
        await reportLatest();
      }
      break;

    default:
      console.log(chalk.red(`Unknown command '${command}'`));
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(chalk.red("[krakzen] Error:"), error instanceof Error ? error.message : error);
  process.exit(1);
});
