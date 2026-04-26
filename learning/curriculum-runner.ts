import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import * as readline from "readline";
import { CurriculumModule } from "./types";
import { loadPlayerState, savePlayerState } from "./state";

async function loadCurriculum(): Promise<CurriculumModule[]> {
  const data = await fs.readJson(
    path.join(process.cwd(), "learning", "data", "curriculum.json")
  ) as CurriculumModule[];
  return data.sort((a, b) => a.order - b.order);
}

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

export async function listModules(): Promise<void> {
  const modules = await loadCurriculum();

  console.log(chalk.cyan("\n  Verum Learning — Linear Curriculum\n"));

  for (const mod of modules) {
    console.log(`  ${chalk.white(`${mod.order}. ${mod.title}`)} (${mod.concept})`);
    for (const obj of mod.objectives) {
      console.log(chalk.gray(`     - ${obj}`));
    }
  }
  console.log("");
}

export async function runModule(moduleId: string): Promise<void> {
  const modules = await loadCurriculum();
  const mod = modules.find((m) => m.id === moduleId);

  if (!mod) {
    console.log(chalk.red(`\n  Unknown module: ${moduleId}`));
    console.log(chalk.gray(`  Available: ${modules.map((m) => m.id).join(", ")}`));
    return;
  }

  console.log(chalk.cyan(`\n  ${mod.title}`));
  console.log(chalk.gray("  " + "=".repeat(mod.title.length)));
  console.log(`\n  ${mod.content}\n`);

  if (mod.quiz.length === 0) {
    console.log(chalk.gray("  No quiz for this module.\n"));
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const state = await loadPlayerState();
  let correct = 0;

  for (const q of mod.quiz) {
    console.log(chalk.white(`  ${q.question}\n`));
    q.choices.forEach((c, i) => {
      console.log(`    ${i + 1}. ${c}`);
    });

    const answer = await ask(rl, chalk.cyan("\n  Your answer (1-4): "));
    const answerIndex = parseInt(answer.trim(), 10) - 1;

    if (answerIndex === q.correctIndex) {
      correct++;
      state.xp += 15;
      console.log(chalk.green(`\n  Correct! +15 XP`));
    } else {
      console.log(chalk.red(`\n  Incorrect.`));
    }
    console.log(chalk.gray(`  ${q.explanation}\n`));
  }

  rl.close();

  console.log(chalk.cyan(`  Score: ${correct}/${mod.quiz.length}`));
  await savePlayerState(state);
  console.log(chalk.gray(`  Progress saved. Total XP: ${state.xp}\n`));
}
