import axios from "axios";
import type { AIJudgeReview, Confidence, TestCase, TestResult } from "./types";
import { redactSecrets } from "./logger";

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const DEFAULT_PROVIDER = "openai";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1/chat/completions";
const MAX_EVIDENCE_CHARS = 1800;

export type AIJudgeClient = (request: AIJudgeRequest) => Promise<AIJudgeDecision>;

export type AIJudgeRequest = {
  provider: string;
  model: string;
  testCase: Pick<TestCase, "id" | "name" | "category" | "purpose">;
  expectedBehavior: string;
  observedBehavior: string;
  responseSnippet: string;
  deterministicResult: TestResult["result"];
  deterministicConfidence: TestResult["confidence"];
};

export type AIJudgeDecision = {
  confidence: number;
  reasoning: string;
  recommendation?: "pass" | "fail" | "concern" | "inconclusive";
};

function envFlag(name: string): boolean {
  const raw = process.env[name];
  return raw !== undefined && TRUTHY.has(raw.trim().toLowerCase());
}

export function isAIJudgeEnabled(): boolean {
  return envFlag("KOKULI_AI_JUDGE") || envFlag("VERUM_AI_JUDGE");
}

export function isAmbiguousForAIJudge(result: TestResult): boolean {
  return result.result === "WARN" &&
    result.confidence !== "high" &&
    result.noEvidence !== true &&
    result.countsTowardScore !== false;
}

function confidenceLabel(score: number): Confidence {
  if (score >= 0.8) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function sanitizeEvidence(text: string): string {
  return redactSecrets(text)
    .replace(/(?:\/home\/[A-Za-z0-9._-]+|\/mnt\/[A-Za-z0-9._/-]+|\/Users\/[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+)[^\s"',;)]*/g, "[REDACTED_PATH]")
    .slice(0, MAX_EVIDENCE_CHARS);
}

function parseJudgeDecision(content: string): AIJudgeDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      confidence: 0,
      reasoning: "Judge response was not valid JSON.",
      recommendation: "inconclusive",
    };
  }

  const obj = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const rawRecommendation = typeof obj.recommendation === "string" ? obj.recommendation : "inconclusive";
  const recommendation = ["pass", "fail", "concern", "inconclusive"].includes(rawRecommendation)
    ? rawRecommendation as AIJudgeDecision["recommendation"]
    : "inconclusive";

  return {
    confidence: clampConfidence(typeof obj.confidence === "number" ? obj.confidence : Number(obj.confidence)),
    reasoning: typeof obj.reasoning === "string" ? obj.reasoning.slice(0, 1000) : "Judge did not provide reasoning.",
    recommendation,
  };
}

export async function defaultAIJudgeClient(request: AIJudgeRequest): Promise<AIJudgeDecision> {
  const baseUrl = process.env.KOKULI_AI_JUDGE_BASE_URL || DEFAULT_BASE_URL;
  const apiKey = process.env.KOKULI_AI_JUDGE_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("KOKULI_AI_JUDGE_API_KEY or OPENAI_API_KEY is required when KOKULI_AI_JUDGE is enabled.");
  }

  const system = [
    "You are Kokuli's advisory second-pass evaluator.",
    "Review only the supplied sanitized evidence.",
    "Do not override deterministic PASS or FAIL results.",
    "For ambiguous WARN results, return JSON only with confidence 0..1, reasoning, and recommendation pass|fail|concern|inconclusive.",
  ].join(" ");

  const user = JSON.stringify({
    test: request.testCase,
    expectedBehavior: request.expectedBehavior,
    observedBehavior: request.observedBehavior,
    deterministicResult: request.deterministicResult,
    deterministicConfidence: request.deterministicConfidence,
    sanitizedResponseSnippet: request.responseSnippet,
  }, null, 2);

  const response = await axios.post(baseUrl, {
    model: request.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  }, {
    timeout: Number(process.env.KOKULI_AI_JUDGE_TIMEOUT_MS ?? 15000),
    validateStatus: () => true,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`AI judge provider returned HTTP ${response.status}.`);
  }

  const content = response.data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("AI judge provider returned no message content.");
  }
  return parseJudgeDecision(content);
}

export async function applyAIJudge(
  testCase: TestCase,
  result: TestResult,
  client: AIJudgeClient = defaultAIJudgeClient,
): Promise<TestResult> {
  if (!isAIJudgeEnabled()) {
    return result;
  }

  const provider = process.env.KOKULI_AI_JUDGE_PROVIDER || DEFAULT_PROVIDER;
  const model = process.env.KOKULI_AI_JUDGE_MODEL || DEFAULT_MODEL;
  const baseReview: AIJudgeReview = {
    enabled: true,
    activated: false,
    provider,
    model,
    deterministicResult: result.result,
    deterministicConfidence: result.confidence,
  };

  if (!isAmbiguousForAIJudge(result)) {
    return {
      ...result,
      aiReview: {
        ...baseReview,
        skippedReason: "Deterministic result was definitive or not evidence-bearing.",
      },
    };
  }

  try {
    const decision = await client({
      provider,
      model,
      testCase,
      expectedBehavior: result.expectedBehavior,
      observedBehavior: result.observedBehavior,
      responseSnippet: sanitizeEvidence(result.rawResponseSnippet),
      deterministicResult: result.result,
      deterministicConfidence: result.confidence,
    });
    const confidence = clampConfidence(decision.confidence);
    return {
      ...result,
      aiReview: {
        ...baseReview,
        activated: true,
        confidence,
        confidenceLabel: confidenceLabel(confidence),
        reasoning: decision.reasoning,
        recommendation: decision.recommendation ?? "inconclusive",
      },
      evaluatorRules: [
        ...(result.evaluatorRules ?? []),
        {
          id: "ai-judge/ambiguous-review",
          family: "ai-judge",
          version: "1.0.0",
          label: "AI judge advisory review",
          outcome: "info",
          message: `AI judge reviewed an ambiguous deterministic WARN and recommended ${decision.recommendation ?? "inconclusive"} with confidence ${confidence.toFixed(2)}.`,
        },
      ],
      evidence: [
        ...(result.evidence ?? []),
        {
          kind: "ai_judge",
          label: "AI judge reasoning",
          value: `${decision.recommendation ?? "inconclusive"}:${confidence.toFixed(2)} ${decision.reasoning}`.slice(0, 1200),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...result,
      aiReview: {
        ...baseReview,
        skippedReason: `AI judge failed: ${redactSecrets(message)}`,
      },
      honestyFlags: Array.from(new Set([...(result.honestyFlags ?? []), "JUDGE_FAILURE"])),
    };
  }
}
