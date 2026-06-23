import test from "node:test";
import assert from "node:assert/strict";
import { applyAIJudge } from "./aiJudge";
import { evaluate } from "./evaluator";
import type { ChatResult, ExpectedBehavior, RequestRecord, ResponseRecord, TestCase } from "./types";

function makeTestCase(expectedBehavior: ExpectedBehavior): TestCase {
  return {
    id: "ai-judge-fixture",
    name: "AI Judge Fixture",
    category: "security",
    target: "demo",
    purpose: "fixture for AI judge tests",
    input: "malformed but harmless",
    expectedBehavior,
    severity: "medium",
  };
}

function makeChatResult(rawText: string): ChatResult {
  const request: RequestRecord = {
    url: "http://demo.test/chat",
    method: "POST",
    headers: {},
    body: {},
    payloadFormat: "messages",
  };
  const response: ResponseRecord = {
    status: 200,
    headers: {},
    rawText,
    normalizedText: rawText,
    normalizedData: rawText,
  };
  return {
    ok: true,
    status: 200,
    data: rawText,
    rawText,
    receipt: { output: rawText },
    retry: { attempted: false },
    durationMs: 25,
    request,
    response,
  };
}

const originalAIJudge = process.env.KOKULI_AI_JUDGE;

test.afterEach(() => {
  if (originalAIJudge === undefined) {
    delete process.env.KOKULI_AI_JUDGE;
  } else {
    process.env.KOKULI_AI_JUDGE = originalAIJudge;
  }
});

test("AI judge activates for ambiguous deterministic WARN results", async () => {
  process.env.KOKULI_AI_JUDGE = "true";
  const tc = makeTestCase({ shouldErrorSafely: true });
  const deterministic = evaluate(tc, makeChatResult("I handled that malformed input as normal content."));
  assert.equal(deterministic.result, "WARN");
  assert.equal(deterministic.confidence, "medium");

  let calls = 0;
  const judged = await applyAIJudge(tc, deterministic, async (request) => {
    calls++;
    assert.equal(request.deterministicResult, "WARN");
    assert.match(request.responseSnippet, /malformed input/);
    return {
      confidence: 0.72,
      recommendation: "concern",
      reasoning: "The response is semantically weak but not a deterministic failure.",
    };
  });

  assert.equal(calls, 1);
  assert.equal(judged.result, "WARN", "AI judge must not override deterministic result");
  assert.equal(judged.aiReview?.activated, true);
  assert.equal(judged.aiReview?.confidence, 0.72);
  assert.equal(judged.aiReview?.confidenceLabel, "medium");
  assert.equal(judged.aiReview?.recommendation, "concern");
  assert.ok(judged.evaluatorRules?.some((rule) => rule.id === "ai-judge/ambiguous-review"));
});

test("AI judge is skipped for definitive deterministic results", async () => {
  process.env.KOKULI_AI_JUDGE = "true";
  const tc = makeTestCase({ shouldReturnContent: true });
  const deterministic = evaluate(tc, makeChatResult("Hello, useful content."));
  assert.equal(deterministic.result, "PASS");
  assert.equal(deterministic.confidence, "high");

  let calls = 0;
  const judged = await applyAIJudge(tc, deterministic, async () => {
    calls++;
    return { confidence: 1, recommendation: "fail", reasoning: "should not run" };
  });

  assert.equal(calls, 0);
  assert.equal(judged.result, "PASS");
  assert.equal(judged.aiReview?.activated, false);
  assert.match(judged.aiReview?.skippedReason ?? "", /definitive/);
});

