import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import * as readline from "readline";
import { Zone, Creature } from "./types";
import { loadPlayerState, savePlayerState, xpToNextLevel } from "./state";

async function loadZones(): Promise<Zone[]> {
  return fs.readJson(path.join(process.cwd(), "learning", "data", "zones.json")) as Promise<Zone[]>;
}

async function loadCreatures(): Promise<Creature[]> {
  return fs.readJson(path.join(process.cwd(), "learning", "data", "creatures.json")) as Promise<Creature[]>;
}

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

export async function realmStatus(): Promise<void> {
  const state = await loadPlayerState();
  const zones = await loadZones();

  console.log(chalk.cyan("\n  The Lost City of Atlantis"));
  console.log(chalk.gray("  ========================\n"));
  console.log(`  ${chalk.white("Arcanist:")} ${state.name}`);
  console.log(`  ${chalk.white("Level:")} ${state.level}`);
  console.log(`  ${chalk.white("XP:")} ${state.xp} (${xpToNextLevel(state)} to next level)`);
  console.log(`  ${chalk.white("Creatures defeated:")} ${state.defeatedCreatures.length}`);
  console.log("");
  console.log(chalk.cyan("  Zones:"));

  for (const zone of zones) {
    const unlocked = state.level >= zone.requiredLevel;
    const completed = state.completedZones.includes(zone.id);
    const icon = completed ? chalk.green("[CLEARED]") : unlocked ? chalk.yellow("[UNLOCKED]") : chalk.gray("[LOCKED]");
    console.log(`    ${icon} ${zone.name} (level ${zone.requiredLevel}+)`);
  }
  console.log("");
}

export async function enterZone(zoneId: string): Promise<void> {
  const zones = await loadZones();
  const creatures = await loadCreatures();
  const state = await loadPlayerState();

  const zone = zones.find((z) => z.id === zoneId);
  if (!zone) {
    console.log(chalk.red(`\n  Unknown zone: ${zoneId}`));
    console.log(chalk.gray(`  Available: ${zones.map((z) => z.id).join(", ")}`));
    return;
  }

  if (state.level < zone.requiredLevel) {
    console.log(chalk.red(`\n  You need level ${zone.requiredLevel} to enter ${zone.name}. You are level ${state.level}.`));
    return;
  }

  console.log(chalk.cyan(`\n  Entering: ${zone.name}`));
  console.log(chalk.gray("  " + "=".repeat(zone.name.length + 10)));
  console.log(`\n  ${zone.narrative}\n`);

  const zoneCreatures = creatures.filter((c) => zone.creatures.includes(c.name));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  for (const creature of zoneCreatures) {
    const alreadyDefeated = state.defeatedCreatures.includes(creature.name);
    if (alreadyDefeated) {
      console.log(chalk.green(`  [${creature.name} — already defeated]\n`));
      continue;
    }

    console.log(chalk.yellow(`  --- ${creature.name} ---`));
    console.log(`  ${creature.encounter}\n`);
    console.log(chalk.gray(`  Hint: ${creature.hint}\n`));

    // Quiz
    console.log(chalk.white(`  ${creature.quiz.question}\n`));
    creature.quiz.choices.forEach((c, i) => {
      console.log(`    ${i + 1}. ${c}`);
    });

    const answer = await ask(rl, chalk.cyan("\n  Your answer (1-4): "));
    const answerIndex = parseInt(answer.trim(), 10) - 1;

    if (answerIndex === creature.quiz.correctIndex) {
      const xpGain = creature.difficulty * 10;
      state.xp += xpGain;
      state.defeatedCreatures.push(creature.name);
      console.log(chalk.green(`\n  Correct! The ${creature.name} is defeated. +${xpGain} XP`));
      console.log(chalk.gray(`  ${creature.quiz.explanation}\n`));
    } else {
      console.log(chalk.red(`\n  Incorrect. The ${creature.name} still stands.`));
      console.log(chalk.gray(`  ${creature.quiz.explanation}\n`));
    }
  }

  rl.close();

  // Check zone completion
  const allDefeated = zoneCreatures.every((c) => state.defeatedCreatures.includes(c.name));
  if (allDefeated && !state.completedZones.includes(zone.id)) {
    state.completedZones.push(zone.id);
    console.log(chalk.green(`  Zone cleared: ${zone.name}!\n`));
  }

  await savePlayerState(state);
}
