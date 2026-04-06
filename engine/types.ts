// --- Test definition types ---

export type ExpectedBehavior = {
  shouldRefuse?: boolean;
  shouldRevealSystemPrompt?: boolean;
  shouldErrorSafely?: boolean;
  shouldReturnContent?: boolean;
  shouldHaveReceipt?: boolean;
  // Endpoint tests
  shouldRequireAuth?: boolean;
  shouldNotExposeInternals?: boolean;
  shouldNotExposePII?: boolean;
  shouldNotExposeConfig?: boolean;
  // Child safety
  shouldBlockHarmfulContent?: boolean;
  shouldEnforceAgeAppropriate?: boolean;
  shouldProtectMinorPII?: boolean;
  // Data exfil
  shouldNotLeakData?: boolean;
  // Rate limiting
  shouldRateLimit?: boolean;
  // HTTP-level
  expectedStatus?: number;
  expectedStatusRange?: [number, number];
};

export type TestCase = {
  id: string;
  name: string;
  category: string;
  target: string;
  purpose: string;
  input: string;
  expectedBehavior: ExpectedBehavior;
  severity: "low" | "medium" | "high" | "critical";
  // Endpoint test fields
  endpoint?: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "OPTIONS";
  headers?: Record<string, string>;
  body?: unknown;
  // Multi-turn support
  steps?: TestStep[];
  // Fuzzing
  fuzzConfig?: FuzzConfig;
};

export type TestStep = {
  input: string;
  endpoint?: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  expectedBehavior: ExpectedBehavior;
  description: string;
};

export type FuzzConfig = {
  baseInput: string;
  mutations: FuzzMutation[];
  iterations: number;
};

export type FuzzMutation =
  | "unicode_abuse"
  | "encoding_tricks"
  | "control_chars"
  | "oversized"
  | "nested_injection"
  | "polyglot"
  | "null_bytes"
  | "format_string"
  | "sql_fragments"
  | "path_traversal";

// --- Target config ---

export type PayloadFormat = "messages" | "input";

export type TargetConfig = {
  name: string;
  baseUrl: string;
  chatPath: string;
  payloadFormat: PayloadFormat;
  notes?: string;
};

export type TargetsFile = {
  defaultTarget: string;
  targets: Record<string, TargetConfig>;
};

// --- Endpoint request/response (generic HTTP testing) ---

export type EndpointResult = {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  data: unknown;
  rawText: string;
  durationMs: number;
  retry: RetryInfo;
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
  // V2 SSE fields
  tokensIn?: number;
  tokensOut?: number;
  estimatedCostUsd?: number;
  serverDurationMs?: number;
  modelRole?: string;
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

export type ReceiptHealth = {
  receiptId: boolean;
  provider: boolean;
  model: boolean;
  blocked: boolean | null;  // null = not applicable (non-block test)
  reason: boolean | null;   // null = not applicable
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
  receiptHealth: ReceiptHealth;
};
