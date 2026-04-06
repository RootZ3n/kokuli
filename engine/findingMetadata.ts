import fs from "fs-extra";
import path from "path";
import { FindingLifecycle, FindingWorkflowMetadata } from "./types";

export type FindingOverride = {
  lifecycle: Extract<FindingLifecycle, "muted" | "accepted_risk">;
  reason: string;
  updatedAt: string;
  owner?: string;
  expiry?: string;
  reviewNote?: string;
};

export type FindingMetadataFile = {
  overrides: Record<string, FindingOverride>;
  workflow: Record<string, FindingWorkflowMetadata>;
};

const METADATA_PATH = path.join(process.cwd(), "reports", "finding-metadata.json");

export async function loadFindingMetadata(): Promise<FindingMetadataFile> {
  if (!(await fs.pathExists(METADATA_PATH))) {
    return { overrides: {}, workflow: {} };
  }
  try {
    const data = await fs.readJson(METADATA_PATH) as FindingMetadataFile;
    return { overrides: data.overrides ?? {}, workflow: data.workflow ?? {} };
  } catch {
    return { overrides: {}, workflow: {} };
  }
}
