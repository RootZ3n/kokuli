import test from "node:test";
import assert from "node:assert/strict";
import {
  VERDICT_DISPLAY,
  verdictFromResult,
  verdictFromGate,
  verdictFromOverall,
  verdictFromLifecycle,
  verdictLabel,
} from "./verdicts";
import { PlatformVerdict } from "./types";

test("VERDICT_DISPLAY contains all expected verdict keys with correct structure", () => {
  const expectedKeys: PlatformVerdict[] = [
    "pass",
    "concern",
    "fail",
    "critical",
    "not_comparable",
    "accepted_risk",
    "muted",
    "resolved",
    "inconclusive",
  ];

  for (const key of expectedKeys) {
    const entry = VERDICT_DISPLAY[key];
    assert.ok(entry, `VERDICT_DISPLAY should have entry for "${key}"`);
    assert.equal(typeof entry.label, "string");
    assert.equal(typeof entry.shortLabel, "string");
    assert.equal(typeof entry.cssClass, "string");
    assert.equal(typeof entry.priority, "number");
  }

  assert.equal(Object.keys(VERDICT_DISPLAY).length, expectedKeys.length);
});

test("verdictFromResult maps PASS to pass", () => {
  assert.equal(verdictFromResult("PASS"), "pass");
});

test("verdictFromResult maps FAIL to fail", () => {
  assert.equal(verdictFromResult("FAIL"), "fail");
});

test("verdictFromResult maps WARN to concern", () => {
  assert.equal(verdictFromResult("WARN"), "concern");
});

test("verdictFromResult returns inconclusive for timeout state regardless of result", () => {
  assert.equal(verdictFromResult("PASS", "timeout"), "inconclusive");
  assert.equal(verdictFromResult("FAIL", "timeout"), "inconclusive");
  assert.equal(verdictFromResult("WARN", "timeout"), "inconclusive");
});

test("verdictFromResult returns inconclusive for error state", () => {
  assert.equal(verdictFromResult("PASS", "error"), "inconclusive");
  assert.equal(verdictFromResult("FAIL", "error"), "inconclusive");
});

test("verdictFromResult returns inconclusive for stale state", () => {
  assert.equal(verdictFromResult("PASS", "stale"), "inconclusive");
});

test("verdictFromResult returns fail for blocked state regardless of result", () => {
  assert.equal(verdictFromResult("PASS", "blocked"), "fail");
  assert.equal(verdictFromResult("WARN", "blocked"), "fail");
  assert.equal(verdictFromResult("FAIL", "blocked"), "fail");
});

test("verdictFromResult returns concern for WARN with normal state", () => {
  assert.equal(verdictFromResult("WARN", "passed"), "concern");
});

test("verdictFromGate maps pass to pass", () => {
  assert.equal(verdictFromGate("pass"), "pass");
});

test("verdictFromGate maps fail to fail", () => {
  assert.equal(verdictFromGate("fail"), "fail");
});

test("verdictFromGate maps warn to concern", () => {
  assert.equal(verdictFromGate("warn"), "concern");
});

test("verdictFromOverall maps Pass to pass", () => {
  assert.equal(verdictFromOverall("Pass"), "pass");
});

test("verdictFromOverall maps Warning to concern", () => {
  assert.equal(verdictFromOverall("Warning"), "concern");
});

test("verdictFromOverall maps Fail to fail", () => {
  assert.equal(verdictFromOverall("Fail"), "fail");
});

test("verdictFromOverall maps Critical to critical", () => {
  assert.equal(verdictFromOverall("Critical"), "critical");
});

test("verdictFromLifecycle returns accepted_risk for accepted_risk lifecycle", () => {
  assert.equal(verdictFromLifecycle("accepted_risk", "fail"), "accepted_risk");
  assert.equal(verdictFromLifecycle("accepted_risk", "pass"), "accepted_risk");
  assert.equal(verdictFromLifecycle("accepted_risk", "critical"), "accepted_risk");
});

test("verdictFromLifecycle returns muted for muted lifecycle", () => {
  assert.equal(verdictFromLifecycle("muted", "fail"), "muted");
  assert.equal(verdictFromLifecycle("muted", "pass"), "muted");
});

test("verdictFromLifecycle returns resolved for resolved lifecycle", () => {
  assert.equal(verdictFromLifecycle("resolved", "fail"), "resolved");
  assert.equal(verdictFromLifecycle("resolved", "pass"), "resolved");
});

test("verdictFromLifecycle returns critical for regressed lifecycle with fail or critical base", () => {
  assert.equal(verdictFromLifecycle("regressed", "fail"), "critical");
  assert.equal(verdictFromLifecycle("regressed", "critical"), "critical");
});

test("verdictFromLifecycle returns base verdict for regressed lifecycle with non-fail/non-critical base", () => {
  assert.equal(verdictFromLifecycle("regressed", "pass"), "pass");
  assert.equal(verdictFromLifecycle("regressed", "concern"), "concern");
});

test("verdictFromLifecycle passes through base verdict for new and recurring lifecycles", () => {
  assert.equal(verdictFromLifecycle("new", "pass"), "pass");
  assert.equal(verdictFromLifecycle("new", "fail"), "fail");
  assert.equal(verdictFromLifecycle("new", "critical"), "critical");
  assert.equal(verdictFromLifecycle("recurring", "concern"), "concern");
  assert.equal(verdictFromLifecycle("recurring", "fail"), "fail");
});

test("verdictLabel returns correct label for each verdict", () => {
  assert.equal(verdictLabel("pass"), "Pass");
  assert.equal(verdictLabel("concern"), "Concern");
  assert.equal(verdictLabel("fail"), "Fail");
  assert.equal(verdictLabel("critical"), "Critical");
  assert.equal(verdictLabel("not_comparable"), "Not Comparable");
  assert.equal(verdictLabel("accepted_risk"), "Accepted Risk");
  assert.equal(verdictLabel("muted"), "Muted");
  assert.equal(verdictLabel("resolved"), "Resolved");
  assert.equal(verdictLabel("inconclusive"), "Inconclusive");
});

test("VERDICT_DISPLAY shortLabels match expected values", () => {
  assert.equal(VERDICT_DISPLAY.pass.shortLabel, "PASS");
  assert.equal(VERDICT_DISPLAY.concern.shortLabel, "CONCERN");
  assert.equal(VERDICT_DISPLAY.fail.shortLabel, "FAIL");
  assert.equal(VERDICT_DISPLAY.critical.shortLabel, "CRITICAL");
  assert.equal(VERDICT_DISPLAY.not_comparable.shortLabel, "N/C");
  assert.equal(VERDICT_DISPLAY.accepted_risk.shortLabel, "ACCEPTED");
  assert.equal(VERDICT_DISPLAY.muted.shortLabel, "MUTED");
  assert.equal(VERDICT_DISPLAY.resolved.shortLabel, "RESOLVED");
  assert.equal(VERDICT_DISPLAY.inconclusive.shortLabel, "INCONCLUSIVE");
});

test("VERDICT_DISPLAY cssClasses describe severity levels", () => {
  assert.equal(VERDICT_DISPLAY.pass.cssClass, "badge-pass");
  assert.equal(VERDICT_DISPLAY.concern.cssClass, "badge-warn");
  assert.equal(VERDICT_DISPLAY.fail.cssClass, "badge-fail");
  assert.equal(VERDICT_DISPLAY.critical.cssClass, "badge-critical");
  assert.equal(VERDICT_DISPLAY.not_comparable.cssClass, "badge-category");
});

test("VERDICT_DISPLAY priorities are ordered by severity", () => {
  assert.ok(VERDICT_DISPLAY.pass.priority < VERDICT_DISPLAY.concern.priority);
  assert.ok(VERDICT_DISPLAY.concern.priority < VERDICT_DISPLAY.fail.priority);
  assert.ok(VERDICT_DISPLAY.fail.priority < VERDICT_DISPLAY.critical.priority);
});

test("verdictFromResult handles missing state the same as passed", () => {
  assert.equal(verdictFromResult("PASS"), "pass");
  assert.equal(verdictFromResult("FAIL"), "fail");
  assert.equal(verdictFromResult("WARN"), "concern");
});
