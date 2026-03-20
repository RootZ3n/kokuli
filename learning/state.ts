import fs from "fs-extra";
import path from "path";
import { PlayerState, XP_PER_LEVEL, levelFromXp } from "./types";

const STATE_PATH = path.join(process.cwd(), "learning", "data", "player.json");

const DEFAULT_STATE: PlayerState = {
  name: "Arcanist",
  level: 1,
  xp: 0,
  completedZones: [],
  defeatedCreatures: [],
  currentZone: null,
};

export async function loadPlayerState(): Promise<PlayerState> {
  if (await fs.pathExists(STATE_PATH)) {
    const state = (await fs.readJson(STATE_PATH)) as PlayerState;
    state.level = levelFromXp(state.xp);
    return state;
  }
  return { ...DEFAULT_STATE };
}

export async function savePlayerState(state: PlayerState): Promise<void> {
  state.level = levelFromXp(state.xp);
  await fs.writeJson(STATE_PATH, state, { spaces: 2 });
}

export function xpToNextLevel(state: PlayerState): number {
  const nextLevelXp = state.level * XP_PER_LEVEL;
  return nextLevelXp - state.xp;
}
