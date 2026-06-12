import { FindingLifecycle, GateStatus, OverallVerdict, PlatformVerdict, ResultState, ResultVerdict } from "./types";

/** Display metadata for a platform verdict. */
export type VerdictDisplay = {
  /** Human-readable full label, e.g. "Not Comparable". */
  label: string;
  /** Short uppercase label for badges, e.g. "N/C". */
  shortLabel: string;
  /** CSS class for badge styling, e.g. "badge-category". */
  cssClass: string;
  /** Numeric priority for sorting (lower = less severe). */
  priority: number;
};

/** Lookup table mapping every PlatformVerdict to its display metadata. */
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

/**
 * Derive a PlatformVerdict from a test result value and optional execution state.
 * Timeout, error, and stale states produce "inconclusive"; blocked produces "fail".
 * Otherwise maps PASS → pass, FAIL → fail, WARN → concern.
 */
export function verdictFromResult(result: ResultVerdict, state?: ResultState): PlatformVerdict {
  if (state === "timeout" || state === "error" || state === "stale") return "inconclusive";
  if (state === "blocked") return "fail";
  if (result === "PASS") return "pass";
  if (result === "FAIL") return "fail";
  return "concern";
}

/**
 * Derive a PlatformVerdict from a gate status.
 * Maps pass → pass, fail → fail, warn → concern.
 */
export function verdictFromGate(status: GateStatus): PlatformVerdict {
  if (status === "pass") return "pass";
  if (status === "fail") return "fail";
  return "concern";
}

/**
 * Derive a PlatformVerdict from an overall (Pass/Warning/Fail/Critical) assessment.
 * Maps Pass → pass, Warning → concern, Fail → fail, Critical → critical.
 */
export function verdictFromOverall(overall: OverallVerdict): PlatformVerdict {
  if (overall === "Pass") return "pass";
  if (overall === "Warning") return "concern";
  if (overall === "Fail") return "fail";
  return "critical";
}

/**
 * Apply lifecycle modifiers to a base verdict.
 * accepted_risk → accepted_risk, muted → muted, resolved → resolved,
 * regressed → critical (if base is fail/critical) else base.
 * All other lifecycles pass through baseVerdict unchanged.
 */
export function verdictFromLifecycle(lifecycle: FindingLifecycle, baseVerdict: PlatformVerdict): PlatformVerdict {
  if (lifecycle === "accepted_risk") return "accepted_risk";
  if (lifecycle === "muted") return "muted";
  if (lifecycle === "resolved") return "resolved";
  if (lifecycle === "regressed" && (baseVerdict === "fail" || baseVerdict === "critical")) return "critical";
  return baseVerdict;
}

/** Return the human-readable label for a platform verdict. */
export function verdictLabel(verdict: PlatformVerdict): string {
  return VERDICT_DISPLAY[verdict].label;
}
