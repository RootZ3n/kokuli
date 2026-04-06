import fs from "fs-extra";
import path from "path";
import { TestCase, TargetsFile, TargetConfig } from "./types";

const targetsPath = () => path.join(process.cwd(), "config", "targets.json");

export async function loadTest(testPath: string): Promise<TestCase> {
  return fs.readJson(testPath) as Promise<TestCase>;
}

export async function loadTargets(): Promise<TargetsFile> {
  return fs.readJson(targetsPath()) as Promise<TargetsFile>;
}

export async function saveTargets(data: TargetsFile): Promise<void> {
  await fs.writeJson(targetsPath(), data, { spaces: 2 });
}

export async function getActiveTarget(): Promise<{ key: string; target: TargetConfig }> {
  const data = await loadTargets();
  const key = data.defaultTarget;
  const target = data.targets[key];
  if (!target) {
    throw new Error(`Active target '${key}' not found in targets.json. Available: ${Object.keys(data.targets).join(", ")}`);
  }
  return { key, target };
}

export async function setActiveTarget(key: string): Promise<TargetConfig> {
  const data = await loadTargets();
  if (!data.targets[key]) {
    throw new Error(`Unknown target '${key}'. Available: ${Object.keys(data.targets).join(", ")}`);
  }
  data.defaultTarget = key;
  await saveTargets(data);
  return data.targets[key];
}

export async function addTarget(key: string, target: TargetConfig): Promise<void> {
  const data = await loadTargets();
  if (data.targets[key]) {
    throw new Error(`Target '${key}' already exists. Use a different key or remove it first.`);
  }
  data.targets[key] = target;
  await saveTargets(data);
}

export async function removeTarget(key: string): Promise<void> {
  const data = await loadTargets();
  if (!data.targets[key]) {
    throw new Error(`Target '${key}' not found.`);
  }
  if (data.defaultTarget === key) {
    throw new Error(`Cannot remove the active target '${key}'. Switch to another target first.`);
  }
  delete data.targets[key];
  await saveTargets(data);
}

export async function resolveTarget(overrideKey?: string): Promise<{ key: string; target: TargetConfig }> {
  const data = await loadTargets();
  const key = overrideKey ?? data.defaultTarget;
  const target = data.targets[key];
  if (!target) {
    throw new Error(`Target '${key}' not found. Available: ${Object.keys(data.targets).join(", ")}`);
  }
  return { key, target };
}
