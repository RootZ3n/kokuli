import fs from "fs-extra";
import path from "path";
import { TestCase, TargetsFile } from "./types";

export async function loadTest(testPath: string): Promise<TestCase> {
  return fs.readJson(testPath) as Promise<TestCase>;
}

export async function loadTargets(): Promise<TargetsFile> {
  const file = path.join(process.cwd(), "config", "targets.json");
  return fs.readJson(file) as Promise<TargetsFile>;
}
