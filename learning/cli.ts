import chalk from "chalk";
import { realmStatus, enterZone } from "./realm";
import { listModules, runModule } from "./curriculum-runner";

const USAGE = `
${chalk.bold("Krakzen Learning Module")} — The Lost City of Atlantis

${chalk.cyan("Realm (Atlantis):")}

  ${chalk.white("realm")}                Enter Atlantis — view your status
  ${chalk.white("realm status")}         Show level, XP, and zone progress
  ${chalk.white("realm zone <id>")}      Enter a zone and face its creatures

${chalk.cyan("Linear Curriculum:")}

  ${chalk.white("learn")}                List available curriculum modules
  ${chalk.white("learn <module-id>")}    Study a module and take its quiz

${chalk.cyan("Zones:")}

  gates-of-poseidon    Level 1  — Firewalls and access controls
  halls-of-echoes      Level 2  — Prompt injection and exfiltration
  coral-gardens        Level 3  — Social engineering
  tidal-depths         Level 5  — DDoS and resilience
  leviathans-chamber   Level 8  — The final test
`;

export async function handleLearningCommand(command: string, arg?: string): Promise<boolean> {
  switch (command) {
    case "realm":
      if (!arg || arg === "status") {
        await realmStatus();
      } else if (arg.startsWith("zone ")) {
        await enterZone(arg.slice(5).trim());
      } else if (arg === "zone") {
        console.log(chalk.red("  Missing zone ID. Use: realm zone <zone-id>"));
      } else {
        console.log(USAGE);
      }
      return true;

    case "learn":
      if (!arg) {
        await listModules();
      } else {
        await runModule(arg);
      }
      return true;

    default:
      return false;
  }
}

export { USAGE as LEARNING_USAGE };
