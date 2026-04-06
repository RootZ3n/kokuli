import { FindingLifecycle, GateStatus, OverallVerdict, PlatformVerdict, ResultState, ResultVerdict } from "./types";

export type VerdictDisplay = {
  label: string;
  shortLabel: string;
  cssClass: string;
  priority: number;
};

export const VERDICT_DISPLAY: Record<PlatformVerdict, VerdictDisplay> = {
  pass: { label: "Pass", shortLabel: "PASS", cssClass: "badge-pass", priority: 1 },
  concern: { label: "Concern", shortLabel: "CONCERN", cssClass: "badge-warn", priority: 2 },
  fail: { label: "Fail", shortLabel: "FAIL", cssClass: "badge-fail", priority: 3 },
  critical: { label: "Critical", shortLabel: "CRITICAL", cssClass: "badge-critical", priority: 4 },
  not_comparable: { label: "Not Comparable", shortLabel: "N/C", cssClass: "badge-category", priority: 5 },
  accepted_risk: { label: "Accepted Risk", shortLabel: "ACCEPTED", cssClass: "badge-category", priority: 2 },
  muted: { label: "Muted", shortLabel: "MUTED", cssClass: "badge-category", priority: 1 },
  resolved: { label: "Resolved", shortLabel: "RESOLVED", cssClass: "badge-pass", priority: 1 },
  inconclusive: { label: "Inconclusive", shortLabel: "INCONCLUSIVE", cssClass: "badge-warn", priority: 2 },
};

export function verdictFromResult(result: ResultVerdict, state?: ResultState): PlatformVerdict {
  if (state === "timeout" || state === "error" || state === "stale") return "inconclusive";
  if (state === "blocked") return "fail";
  if (result === "PASS") return "pass";
  if (result === "FAIL") return "fail";
  return "concern";
}

export function verdictFromGate(status: GateStatus): PlatformVerdict {
  if (status === "pass") return "pass";
  if (status === "fail") return "fail";
  return "concern";
}

export function verdictFromOverall(overall: OverallVerdict): PlatformVerdict {
  if (overall === "Pass") return "pass";
  if (overall === "Warning") return "concern";
  if (overall === "Fail") return "fail";
  return "critical";
}

export function verdictFromLifecycle(lifecycle: FindingLifecycle, baseVerdict: PlatformVerdict): PlatformVerdict {
  if (lifecycle === "accepted_risk") return "accepted_risk";
  if (lifecycle === "muted") return "muted";
  if (lifecycle === "resolved") return "resolved";
  if (lifecycle === "regressed" && (baseVerdict === "fail" || baseVerdict === "critical")) return "critical";
  return baseVerdict;
}

export function verdictLabel(verdict: PlatformVerdict): string {
  return VERDICT_DISPLAY[verdict].label;
}
