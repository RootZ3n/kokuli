import crypto from "crypto";
import fs from "fs-extra";
import path from "path";
import { DashboardAssessment, FindingRecord, IntegrityRecord, TargetFingerprint } from "./types";

export type AssessmentSnapshot = {
  id: string;
  target: string;
  targetName?: string;
  generatedAt: string;
  summary: DashboardAssessment["summary"];
  riskSummary: DashboardAssessment["riskSummary"];
  findings: FindingRecord[];
  metrics?: DashboardAssessment["metrics"];
  targetFingerprint?: TargetFingerprint;
  integrity: IntegrityRecord;
};

const HISTORY_PATH = path.join(process.cwd(), "reports", "history.json");

export async function loadAssessmentHistory(): Promise<AssessmentSnapshot[]> {
  if (!(await fs.pathExists(HISTORY_PATH))) return [];
  try {
    const history = await fs.readJson(HISTORY_PATH);
    return Array.isArray(history) ? history : [];
  } catch {
    return [];
  }
}

export function verifyIntegrityChain(history: AssessmentSnapshot[]): IntegrityRecord | undefined {
  if (!history.length) return undefined;
  for (let index = 0; index < history.length; index++) {
    const snapshot = history[index];
    if (!snapshot.integrity) {
      return {
        sequence: index + 1,
        checksum: "",
        chainHash: "",
        status: "warning",
        warning: "One or more historical snapshots predate integrity metadata.",
      };
    }
    const previous = history[index - 1];
    const payload = {
      id: snapshot.id,
      target: snapshot.target,
      targetName: snapshot.targetName,
      generatedAt: snapshot.generatedAt,
      summary: snapshot.summary,
      riskSummary: snapshot.riskSummary,
      findings: snapshot.findings,
      metrics: snapshot.metrics,
      targetFingerprint: snapshot.targetFingerprint,
    };
    const checksum = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const expectedPreviousChecksum = previous?.integrity.chainHash;
    const chainHash = crypto.createHash("sha256").update([expectedPreviousChecksum ?? "GENESIS", checksum].join(":")).digest("hex");
    if (snapshot.integrity.checksum !== checksum || snapshot.integrity.chainHash !== chainHash) {
      return {
        ...snapshot.integrity,
        status: "warning",
        warning: `Integrity chain mismatch detected at snapshot sequence ${snapshot.integrity.sequence}.`,
      };
    }
  }
  const last = history[history.length - 1].integrity;
  return {
    ...last,
    status: history.length > 1 ? "ok" : "genesis",
  };
}

export async function appendAssessmentSnapshot(assessment: DashboardAssessment): Promise<void> {
  const history = await loadAssessmentHistory();
  const previous = history[history.length - 1];
  const sequence = previous?.integrity?.sequence ? previous.integrity.sequence + 1 : history.length + 1;
  const payload = {
    id: `${assessment.target}-${assessment.generatedAt}`,
    target: assessment.target,
    targetName: assessment.targetName,
    generatedAt: assessment.generatedAt,
    summary: assessment.summary,
    riskSummary: assessment.riskSummary,
    findings: assessment.findings,
    metrics: assessment.metrics,
    targetFingerprint: assessment.targetFingerprint,
  };
  const checksum = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const previousChecksum = previous?.integrity?.chainHash;
  const chainHash = crypto.createHash("sha256").update([previousChecksum ?? "GENESIS", checksum].join(":")).digest("hex");
  const integrity: IntegrityRecord = {
    sequence,
    checksum,
    previousChecksum,
    chainHash,
    status: previous ? "ok" : "genesis",
  };

  history.push({
    ...payload,
    integrity,
  });
  assessment.integrity = integrity;
  await fs.ensureDir(path.dirname(HISTORY_PATH));
  await fs.writeJson(HISTORY_PATH, history.slice(-200), { spaces: 2 });
}

export async function getPreviousSnapshot(target: string): Promise<AssessmentSnapshot | undefined> {
  const history = await loadAssessmentHistory();
  const matching = history.filter((snapshot) => snapshot.target === target);
  return matching.length >= 2 ? matching[matching.length - 2] : undefined;
}

export async function getLatestSnapshot(target: string): Promise<AssessmentSnapshot | undefined> {
  const history = await loadAssessmentHistory();
  const matching = history.filter((snapshot) => snapshot.target === target);
  return matching[matching.length - 1];
}
