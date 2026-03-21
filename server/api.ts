import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs-extra";
import { globSync } from "glob";
import { loadTargets, loadTest } from "../engine/loaders";
import { sendChat } from "../engine/client";
import { evaluate } from "../engine/evaluator";
import { writeReport, writeSuiteSummary } from "../engine/reportWriter";
import { TestCase, TestResult } from "../engine/types";
import { Zone, Creature, CurriculumModule } from "../learning/types";
import { loadPlayerState, savePlayerState, xpToNextLevel } from "../learning/state";

const router = Router();

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

// GET /api/targets — list targets
router.get("/targets", async (_req: Request, res: Response) => {
  try {
    const targets = await loadTargets();
    res.json(targets);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/tests/:id/run — run a single test
router.post("/tests/:id/run", async (req: Request, res: Response) => {
  try {
    const registry = await buildRegistry();
    const testId = param(req, "id");
    const entry = registry.find((e) => e.id === testId);
    if (!entry) {
      res.status(404).json({ error: `Unknown test: ${testId}` });
      return;
    }

    const targets = await loadTargets();
    const target = targets.targets[entry.test.target];
    if (!target) {
      res.status(400).json({ error: `Unknown target: ${entry.test.target}` });
      return;
    }

    const chat = await sendChat(target, entry.test.input);
    const result = evaluate(entry.test, chat);
    await writeReport(result);

    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/suite/:category — run a suite
router.post("/suite/:category", async (req: Request, res: Response) => {
  try {
    const category = param(req, "category");
    const registry = await buildRegistry(category === "all" ? undefined : category);

    if (!registry.length) {
      res.status(404).json({ error: `No tests found for suite: ${category}` });
      return;
    }

    const results: TestResult[] = [];
    const targets = await loadTargets();

    for (const entry of registry) {
      const target = targets.targets[entry.test.target];
      if (!target) continue;

      const chat = await sendChat(target, entry.test.input);
      const result = evaluate(entry.test, chat);
      await writeReport(result);
      results.push(result);
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
    const { questionIndex, answerIndex } = req.body as { questionIndex: number; answerIndex: number };
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
