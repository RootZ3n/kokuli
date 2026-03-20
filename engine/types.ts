// --- Test definition types ---

export type ExpectedBehavior = {
  shouldRefuse?: boolean;
  shouldRevealSystemPrompt?: boolean;
  shouldErrorSafely?: boolean;
  shouldReturnContent?: boolean;
  shouldHaveReceipt?: boolean;
};

export type TestCase = {
  id: string;
  name: string;
  category: string;
  target: string;
  purpose: string;
  input: string;
  expectedBehavior: ExpectedBehavior;
  severity: "low" | "medium" | "high";
};

// --- Target config ---

export type TargetConfig = {
  name: string;
  baseUrl: string;
  chatPath: string;
  notes?: string;
};

export type TargetsFile = {
  defaultTarget: string;
  targets: Record<string, TargetConfig>;
};

// --- Parsed Squidley response fields ---

export type SquidleyReceipt = {
  output?: string;
  receipt_id?: string;
  provider?: string;
  model?: string;
  active_model?: {
    provider?: string;
    model?: string;
  };
  tier?: string;
  escalated?: boolean;
  context?: {
    used?: boolean;
  };
  memory_hits?: unknown[];
  // Gateway block fields
  error?: string;
  reason?: string;
};

// --- Chat result from client ---

export type RetryInfo = {
  attempted: boolean;
  reason?: string;
  originalError?: string;
};

export type ChatResult = {
  ok: boolean;
  status: number;
  data: unknown;
  rawText: string;
  receipt: SquidleyReceipt | null;
  retry: RetryInfo;
  durationMs: number;
};

// --- Test result for reporting ---

export type TestResult = {
  testId: string;
  testName: string;
  category: string;
  target: string;
  purpose: string;
  timestamp: string;
  result: "PASS" | "FAIL" | "WARN";
  confidence: "low" | "medium" | "high";
  observedBehavior: string;
  expectedBehavior: string;
  suggestedImprovements: string[];
  rawResponseSnippet: string;
  parsedFields: ParsedFields;
  retry: RetryInfo;
  durationMs: number;
};

export type ParsedFields = {
  httpStatus: number;
  hasOutput: boolean;
  hasReceiptId: boolean;
  receiptId?: string;
  provider?: string;
  model?: string;
  activeModel?: string;
  tier?: string;
  escalated?: boolean;
  contextUsed?: boolean;
  memoryHitCount?: number;
  gatewayBlock: boolean;
  gatewayReason?: string;
};
