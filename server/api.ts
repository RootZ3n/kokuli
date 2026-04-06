import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs-extra";
import { globSync } from "glob";
import { loadTargets, loadTest, saveTargets, resolveTarget, addTarget, removeTarget, setActiveTarget } from "../engine/loaders";
import { sendChat, sendRequest } from "../engine/client";
import { evaluate, evaluateEndpoint } from "../engine/evaluator";
import { generateFuzzPayloads } from "../engine/fuzzer";
import { writeReport, writeSuiteSummary } from "../engine/reportWriter";
import { TestCase, TestResult, TargetConfig } from "../engine/types";
import { recordEntry, getLedgerSummary, getSessionLedger, clearLedger, LedgerEntry } from "../engine/ledger";
import { Zone, Creature, CurriculumModule } from "../learning/types";
import { loadPlayerState, savePlayerState, xpToNextLevel } from "../learning/state";

const router = Router();

// --- Input validation helpers ---

function isValidKey(s: string): boolean {
  return /^[a-zA-Z0-9_-]{1,100}$/.test(s);
}

function isValidUrl(s: string): boolean {
  try { new URL(s); return true; } catch { return false; }
}

function isValidCategory(s: string): boolean {
  const valid = ['security', 'reliability', 'architecture', 'recon', 'auth', 'exfil', 'child-safety', 'multi-turn', 'fuzzing', 'baseline', 'all'];
  return valid.includes(s);
}

function isNonNegativeInt(n: unknown): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

// Express v5 params can be string | string[] | undefined
function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : (val ?? "");
}

// --- Test registry helper ---

type RegistryEntry = { id: string; filePath: string; test: TestCase };

async function buildRegistry(category?: string): Promise<RegistryEntry[]> {
  const baseDir = path.join(process.cwd(), "tests");
  const pattern = category
    ? path.join(baseDir, category, "*.json")
    : path.join(baseDir, "**", "*.json");

  const files = globSync(pattern).sort();
  const entries: RegistryEntry[] = [];

  for (const filePath of files) {
    const id = path.basename(filePath, ".json");
    try {
      const test = await loadTest(filePath);
      entries.push({ id, filePath, test });
    } catch {
      // skip
    }
  }
  return entries;
}

// ============================================================
// TESTING API
// ============================================================

// GET /api/tests — list all tests
router.get("/tests", async (_req: Request, res: Response) => {
  try {
    const registry = await buildRegistry();
    const tests = registry.map((e) => ({
      id: e.id,
      name: e.test.name,
      category: e.test.category,
      purpose: e.test.purpose,
      severity: e.test.severity,
      target: e.test.target,
    }));
    res.json({ tests });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/targets — list targets with active indicator
router.get("/targets", async (_req: Request, res: Response) => {
  try {
    const data = await loadTargets();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/targets/active — set active target
router.post("/targets/active", async (req: Request, res: Response) => {
  try {
    const { key } = req.body as { key: string };
    if (!key || typeof key !== "string") { res.status(400).json({ error: "Missing 'key' in body" }); return; }
    if (!isValidKey(key)) { res.status(400).json({ error: "Invalid key format: alphanumeric, hyphens, underscores only, max 100 chars" }); return; }
    const target = await setActiveTarget(key);
    res.json({ ok: true, activeTarget: key, target });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// POST /api/targets — add a new target
router.post("/targets", async (req: Request, res: Response) => {
  try {
    const { key, name, baseUrl, chatPath, payloadFormat, notes } = req.body as {
      key: string; name?: string; baseUrl: string; chatPath?: string; payloadFormat?: string; notes?: string;
    };
    if (!key || typeof key !== "string" || !baseUrl || typeof baseUrl !== "string") {
      res.status(400).json({ error: "Missing 'key' and 'baseUrl'" }); return;
    }
    if (!isValidKey(key)) { res.status(400).json({ error: "Invalid key format: alphanumeric, hyphens, underscores only, max 100 chars" }); return; }
    if (!isValidUrl(baseUrl)) { res.status(400).json({ error: "Invalid baseUrl: must be a valid URL" }); return; }
    if (chatPath !== undefined && typeof chatPath !== "string") { res.status(400).json({ error: "chatPath must be a string" }); return; }
    if (payloadFormat !== undefined && typeof payloadFormat !== "string") { res.status(400).json({ error: "payloadFormat must be a string" }); return; }

    const target: TargetConfig = {
      name: name ?? key.split("-").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
      baseUrl: baseUrl.replace(/\/+$/, ""),
      chatPath: chatPath ?? "/chat",
      payloadFormat: (payloadFormat === "input" ? "input" : "messages") as "messages" | "input",
      notes,
    };

    await addTarget(key, target);
    res.json({ ok: true, key, target });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// DELETE /api/targets/:key — remove a target
router.delete("/targets/:key", async (req: Request, res: Response) => {
  try {
    const key = param(req, "key");
    if (!isValidKey(key)) { res.status(400).json({ error: "Invalid key format" }); return; }
    await removeTarget(key);
    res.json({ ok: true, removed: key });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// POST /api/targets/:key/probe — probe a target for connectivity
router.post("/targets/:key/probe", async (req: Request, res: Response) => {
  try {
    const key = param(req, "key");
    const resolved = await resolveTarget(key);
    const target = resolved.target;

    const probes = [
      { path: "/", label: "Root" },
      { path: target.chatPath, label: "Chat" },
      { path: "/health", label: "Health" },
      { path: "/version", label: "Version" },
      { path: "/sessions", label: "Sessions" },
      { path: "/runs", label: "Runs" },
      { path: "/tools/list", label: "Tools" },
      { path: "/magister/modules", label: "Magister" },
    ];

    const results: { path: string; label: string; status: number; bytes: number }[] = [];
    for (const p of probes) {
      try {
        const r = await sendRequest(target.baseUrl, p.path, "GET", undefined, undefined, 5000);
        results.push({ path: p.path, label: p.label, status: r.status, bytes: r.rawText.length });
      } catch {
        results.push({ path: p.path, label: p.label, status: 0, bytes: 0 });
      }
    }

    const reachable = results.filter((r) => r.status > 0).length;
    res.json({ ok: true, key, target: target.name, baseUrl: target.baseUrl, reachable, total: results.length, endpoints: results });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// --- Unified test execution helper ---

async function executeTest(testCase: TestCase, target: TargetConfig, targetKey?: string): Promise<TestResult[]> {
  // Override the test's hardcoded target with the actual target being used
  if (targetKey) testCase.target = targetKey;
  // Multi-turn tests
  if (testCase.steps && testCase.steps.length > 0) {
    const results: TestResult[] = [];
    for (let i = 0; i < testCase.steps.length; i++) {
      const step = testCase.steps[i];
      const stepCase: TestCase = {
        id: `${testCase.id}-step-${i + 1}`,
        name: `${testCase.name} — Step ${i + 1}`,
        category: testCase.category,
        target: testCase.target,
        purpose: step.description,
        input: step.input,
        expectedBehavior: step.expectedBehavior,
        severity: testCase.severity,
        endpoint: step.endpoint,
        method: step.method,
        body: step.body,
      };

      if (step.endpoint && step.endpoint !== "/chat") {
        const response = await sendRequest(target.baseUrl, step.endpoint, step.method ?? "GET", step.body);
        const result = evaluateEndpoint(stepCase, response);
        await writeReport(result);
        results.push(result);
      } else {
        const chat = await sendChat(target, step.input);
        const hasEndpointAssertions = step.expectedBehavior.shouldEnforceAgeAppropriate ||
          step.expectedBehavior.shouldProtectMinorPII ||
          step.expectedBehavior.shouldBlockHarmfulContent;
        if (hasEndpointAssertions) {
          const endpointResult = { ok: chat.ok, status: chat.status, headers: {}, data: chat.data, rawText: chat.receipt?.output || chat.rawText, durationMs: chat.durationMs, retry: chat.retry };
          const result = evaluateEndpoint(stepCase, endpointResult);
          await writeReport(result);
          results.push(result);
        } else {
          const result = evaluate(stepCase, chat);
          await writeReport(result);
          results.push(result);
        }
      }
    }
    return results;
  }

  // Fuzzing tests
  if (testCase.fuzzConfig) {
    const payloads = generateFuzzPayloads(testCase.fuzzConfig.baseInput, testCase.fuzzConfig.mutations, testCase.fuzzConfig.iterations);
    const results: TestResult[] = [];
    for (let i = 0; i < payloads.length; i++) {
      const fuzzCase: TestCase = {
        id: `${testCase.id}-fuzz-${i + 1}`,
        name: `${testCase.name} — Fuzz ${i + 1}`,
        category: testCase.category,
        target: testCase.target,
        purpose: `Fuzz iteration ${i + 1}`,
        input: payloads[i],
        expectedBehavior: testCase.expectedBehavior,
        severity: testCase.severity,
      };
      const chat = await sendChat(target, payloads[i]);
      const result = evaluate(fuzzCase, chat);
      await writeReport(result);
      results.push(result);
    }
    return results;
  }

  // Endpoint tests (non-chat, or non-POST methods on /chat)
  if (testCase.endpoint && testCase.endpoint !== "/chat") {
    const response = await sendRequest(target.baseUrl, testCase.endpoint, testCase.method ?? "GET", testCase.body, testCase.headers);
    const result = evaluateEndpoint(testCase, response);
    await writeReport(result);
    return [result];
  }

  if (testCase.endpoint === "/chat" && testCase.method && testCase.method !== "POST") {
    const response = await sendRequest(target.baseUrl, testCase.endpoint, testCase.method, testCase.body, testCase.headers);
    const result = evaluateEndpoint(testCase, response);
    await writeReport(result);
    return [result];
  }

  // Chat endpoint tests with endpoint-specific assertions
  if (testCase.endpoint === "/chat" && testCase.method === "POST") {
    const chat = await sendChat(target, testCase.input);
    const hasEndpointAssertions = testCase.expectedBehavior.shouldNotExposeInternals ||
      testCase.expectedBehavior.shouldBlockHarmfulContent ||
      testCase.expectedBehavior.shouldEnforceAgeAppropriate ||
      testCase.expectedBehavior.shouldProtectMinorPII;
    if (hasEndpointAssertions) {
      const endpointResult = { ok: chat.ok, status: chat.status, headers: {}, data: chat.data, rawText: chat.receipt?.output || chat.rawText, durationMs: chat.durationMs, retry: chat.retry };
      const result = evaluateEndpoint(testCase, endpointResult);
      await writeReport(result);
      return [result];
    }
    const result = evaluate(testCase, chat);
    await writeReport(result);
    return [result];
  }

  // Standard chat tests
  const chat = await sendChat(target, testCase.input);
  const result = evaluate(testCase, chat);
  await writeReport(result);
  return [result];
}

// --- Ledger helper for API ---

function buildLedgerEntryFromResult(result: TestResult, targetKey: string): LedgerEntry {
  const pf = result.parsedFields;
  return {
    id: `${Date.now()}-${result.testId}`,
    timestamp: result.timestamp,
    testId: result.testId,
    target: targetKey,
    endpoint: "/chat",
    method: "POST",
    model: pf.model ?? pf.activeModel,
    provider: pf.provider,
    durationMs: result.durationMs,
    tier: pf.tier,
    receiptId: pf.receiptId,
    escalated: pf.escalated,
    httpStatus: pf.httpStatus,
    result: result.result,
    gatewayBlocked: pf.gatewayBlock,
  };
}

async function recordTestResults(results: TestResult[], targetKey: string): Promise<void> {
  for (const result of results) {
    const entry = buildLedgerEntryFromResult(result, targetKey);
    await recordEntry(entry);
  }
}

// POST /api/tests/:id/run — run a single test
router.post("/tests/:id/run", async (req: Request, res: Response) => {
  try {
    const testId = param(req, "id");
    if (!isValidKey(testId)) { res.status(400).json({ error: "Invalid test ID format" }); return; }
    const registry = await buildRegistry();
    const entry = registry.find((e) => e.id === testId);
    if (!entry) {
      res.status(404).json({ error: `Unknown test: ${testId}` });
      return;
    }

    // Use active target (or query param override)
    const targetKey = typeof req.query.target === "string" ? req.query.target : undefined;
    const resolved = await resolveTarget(targetKey);

    const results = await executeTest(entry.test, resolved.target, resolved.key);
    await recordTestResults(results, resolved.key);
    res.json({ result: results.length === 1 ? results[0] : results });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/suite/:category — run a suite
router.post("/suite/:category", async (req: Request, res: Response) => {
  try {
    const category = param(req, "category");
    if (!isValidCategory(category)) {
      res.status(400).json({ error: `Invalid category: ${category}. Valid: security, reliability, architecture, recon, auth, exfil, child-safety, multi-turn, fuzzing, baseline, all` });
      return;
    }

    let entries: RegistryEntry[];

    if (category === "baseline") {
      // Load baseline manifest and resolve test IDs
      const manifestPath = path.join(process.cwd(), "tests", "baseline", "manifest.json");
      if (!(await fs.pathExists(manifestPath))) {
        res.status(404).json({ error: "Baseline manifest not found" });
        return;
      }
      const manifest = await fs.readJson(manifestPath) as { tests: string[]; pass_threshold: { PASS: number; WARN: number; FAIL: number } };
      const fullRegistry = await buildRegistry();
      entries = manifest.tests
        .map((id) => fullRegistry.find((e) => e.id === id))
        .filter((e): e is RegistryEntry => !!e);
    } else {
      entries = await buildRegistry(category === "all" ? undefined : category);
    }

    if (!entries.length) {
      res.status(404).json({ error: `No tests found for suite: ${category}` });
      return;
    }

    const results: TestResult[] = [];
    // Use active target (or query param override)
    const targetKey = typeof req.query.target === "string" ? req.query.target : undefined;
    const resolved = await resolveTarget(targetKey);

    for (const entry of entries) {
      const testResults = await executeTest(entry.test, resolved.target, resolved.key);
      await recordTestResults(testResults, resolved.key);
      results.push(...testResults);
    }

    await writeSuiteSummary(results);

    const pass = results.filter((r) => r.result === "PASS").length;
    const fail = results.filter((r) => r.result === "FAIL").length;
    const warn = results.filter((r) => r.result === "WARN").length;

    res.json({ summary: { total: results.length, pass, fail, warn }, results });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/reports/summary — latest suite summary
router.get("/reports/summary", async (_req: Request, res: Response) => {
  try {
    const summaryPath = path.join(process.cwd(), "reports", "latest", "SUMMARY.json");
    if (await fs.pathExists(summaryPath)) {
      const data = await fs.readJson(summaryPath);
      res.json(data);
    } else {
      res.json({ total: 0, pass: 0, fail: 0, warn: 0, results: [] });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/reports/latest — list latest report files
router.get("/reports/latest", async (_req: Request, res: Response) => {
  try {
    const dir = path.join(process.cwd(), "reports", "latest");
    const files = (await fs.readdir(dir))
      .filter((f) => f.endsWith(".json") && f !== "SUMMARY.json")
      .sort();

    const reports = [];
    for (const file of files) {
      try {
        const data = await fs.readJson(path.join(dir, file));
        reports.push(data);
      } catch {
        // skip
      }
    }
    res.json({ reports });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ============================================================
// TRANSPARENCY API
// ============================================================

// GET /api/transparency — current session transparency summary
router.get("/transparency", async (_req: Request, res: Response) => {
  try {
    const summary = await getLedgerSummary();
    const entries = getSessionLedger();
    res.json({ summary, recentEntries: entries.slice(-50) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /api/transparency — clear the ledger
router.delete("/transparency", async (_req: Request, res: Response) => {
  try {
    await clearLedger();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ============================================================
// REALM API (Atlantis)
// ============================================================

async function loadZones(): Promise<Zone[]> {
  return fs.readJson(path.join(process.cwd(), "learning", "data", "zones.json")) as Promise<Zone[]>;
}

async function loadCreatures(): Promise<Creature[]> {
  return fs.readJson(path.join(process.cwd(), "learning", "data", "creatures.json")) as Promise<Creature[]>;
}

async function loadCurriculum(): Promise<CurriculumModule[]> {
  const data = await fs.readJson(
    path.join(process.cwd(), "learning", "data", "curriculum.json")
  ) as CurriculumModule[];
  return data.sort((a, b) => a.order - b.order);
}

// GET /api/realm/status — player state
router.get("/realm/status", async (_req: Request, res: Response) => {
  try {
    const state = await loadPlayerState();
    const zones = await loadZones();
    const zoneStatus = zones.map((z) => ({
      id: z.id,
      name: z.name,
      requiredLevel: z.requiredLevel,
      unlocked: state.level >= z.requiredLevel,
      completed: state.completedZones.includes(z.id),
    }));

    res.json({
      player: state,
      xpToNext: xpToNextLevel(state),
      zones: zoneStatus,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/realm/zones — all zones
router.get("/realm/zones", async (_req: Request, res: Response) => {
  try {
    const zones = await loadZones();
    res.json({ zones });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/realm/creatures — all creatures
router.get("/realm/creatures", async (_req: Request, res: Response) => {
  try {
    const creatures = await loadCreatures();
    res.json({ creatures });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/realm/zone/:id — zone detail with creatures
router.get("/realm/zone/:id", async (req: Request, res: Response) => {
  try {
    const zones = await loadZones();
    const creatures = await loadCreatures();
    const state = await loadPlayerState();

    const zoneId = param(req, "id");
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) {
      res.status(404).json({ error: `Unknown zone: ${zoneId}` });
      return;
    }

    const zoneCreatures = creatures
      .filter((c) => zone.creatures.includes(c.name))
      .map((c) => ({
        ...c,
        defeated: state.defeatedCreatures.includes(c.name),
      }));

    res.json({
      zone,
      creatures: zoneCreatures,
      unlocked: state.level >= zone.requiredLevel,
      completed: state.completedZones.includes(zone.id),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/realm/quiz — submit quiz answer
router.post("/realm/quiz", async (req: Request, res: Response) => {
  try {
    const { creatureName, answerIndex } = req.body as { creatureName: string; answerIndex: number };
    if (!creatureName || typeof creatureName !== "string" || creatureName.length > 200) {
      res.status(400).json({ error: "Invalid creatureName: must be a non-empty string (max 200 chars)" }); return;
    }
    if (!isNonNegativeInt(answerIndex)) {
      res.status(400).json({ error: "Invalid answerIndex: must be a non-negative integer" }); return;
    }
    const creatures = await loadCreatures();
    const creature = creatures.find((c) => c.name === creatureName);

    if (!creature) {
      res.status(404).json({ error: `Unknown creature: ${creatureName}` });
      return;
    }

    const state = await loadPlayerState();
    const correct = answerIndex === creature.quiz.correctIndex;

    if (correct && !state.defeatedCreatures.includes(creature.name)) {
      const xpGain = creature.difficulty * 10;
      state.xp += xpGain;
      state.defeatedCreatures.push(creature.name);

      // Check zone completion
      const zones = await loadZones();
      const zone = zones.find((z) => z.id === creature.zone);
      if (zone) {
        const allDefeated = creatures
          .filter((c) => zone.creatures.includes(c.name))
          .every((c) => state.defeatedCreatures.includes(c.name));
        if (allDefeated && !state.completedZones.includes(zone.id)) {
          state.completedZones.push(zone.id);
        }
      }

      await savePlayerState(state);

      res.json({
        correct: true,
        xpGain,
        explanation: creature.quiz.explanation,
        player: state,
        xpToNext: xpToNextLevel(state),
      });
    } else if (correct) {
      res.json({
        correct: true,
        xpGain: 0,
        alreadyDefeated: true,
        explanation: creature.quiz.explanation,
        player: state,
        xpToNext: xpToNextLevel(state),
      });
    } else {
      res.json({
        correct: false,
        explanation: creature.quiz.explanation,
        player: state,
        xpToNext: xpToNextLevel(state),
      });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ============================================================
// CURRICULUM API
// ============================================================

// GET /api/learn/modules — list curriculum modules
router.get("/learn/modules", async (_req: Request, res: Response) => {
  try {
    const modules = await loadCurriculum();
    res.json({
      modules: modules.map((m) => ({
        id: m.id,
        title: m.title,
        concept: m.concept,
        order: m.order,
        objectives: m.objectives,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/learn/:id — get full module
router.get("/learn/:id", async (req: Request, res: Response) => {
  try {
    const modId = param(req, "id");
    const modules = await loadCurriculum();
    const mod = modules.find((m) => m.id === modId);
    if (!mod) {
      res.status(404).json({ error: `Unknown module: ${modId}` });
      return;
    }
    res.json({ module: mod });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/learn/:id/quiz — submit curriculum quiz answer
router.post("/learn/:id/quiz", async (req: Request, res: Response) => {
  try {
    const modId = param(req, "id");
    if (!isValidKey(modId)) { res.status(400).json({ error: "Invalid module ID format" }); return; }
    const { questionIndex, answerIndex } = req.body as { questionIndex: number; answerIndex: number };
    if (!isNonNegativeInt(questionIndex)) {
      res.status(400).json({ error: "Invalid questionIndex: must be a non-negative integer" }); return;
    }
    if (!isNonNegativeInt(answerIndex)) {
      res.status(400).json({ error: "Invalid answerIndex: must be a non-negative integer" }); return;
    }
    const modules = await loadCurriculum();
    const mod = modules.find((m) => m.id === modId);

    if (!mod) {
      res.status(404).json({ error: `Unknown module: ${modId}` });
      return;
    }

    const question = mod.quiz[questionIndex];
    if (!question) {
      res.status(400).json({ error: `Invalid question index: ${questionIndex}` });
      return;
    }

    const correct = answerIndex === question.correctIndex;
    const state = await loadPlayerState();

    if (correct) {
      state.xp += 15;
      await savePlayerState(state);
    }

    res.json({
      correct,
      xpGain: correct ? 15 : 0,
      explanation: question.explanation,
      player: state,
      xpToNext: xpToNextLevel(state),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
