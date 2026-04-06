import fs from "fs-extra";
import { TestCase, TargetsFile, TargetConfig } from "./types";
import {
  addTarget as createTargetRecord,
  deleteTarget,
  getActiveTarget as getResolvedActiveTarget,
  loadTargets as loadNormalizedTargets,
  resolveTarget as resolveExecutionTarget,
  saveTargets as saveNormalizedTargets,
  setActiveTarget as setCurrentTarget,
} from "./targets";

export async function loadTest(testPath: string): Promise<TestCase> {
  return fs.readJson(testPath) as Promise<TestCase>;
}

export async function loadTargets(): Promise<TargetsFile> {
  return loadNormalizedTargets();
}

export async function saveTargets(data: TargetsFile): Promise<void> {
  await saveNormalizedTargets(data);
}

export async function getActiveTarget(): Promise<{ key: string; target: TargetConfig }> {
  return getResolvedActiveTarget();
}

export async function setActiveTarget(key: string): Promise<TargetConfig> {
  return setCurrentTarget(key);
}

export async function addTarget(key: string, target: TargetConfig): Promise<void> {
  await createTargetRecord(key, target);
}

export async function removeTarget(key: string): Promise<void> {
  await deleteTarget(key);
}

export async function resolveTarget(overrideKey?: string): Promise<{ key: string; target: TargetConfig }> {
  return resolveExecutionTarget(overrideKey);
}
