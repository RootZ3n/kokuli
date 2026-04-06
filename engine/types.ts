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

export type ResultState =
  | "idle"
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "blocked"
  | "error"
  | "timeout"
  | "skipped"
  | "stale";

export type ResultVerdict = "PASS" | "FAIL" | "WARN";
export type Confidence = "low" | "medium" | "high";
export type Severity = "low" | "medium" | "high" | "critical";
export type OverallVerdict = "Pass" | "Warning" | "Fail" | "Critical";
export type GateStatus = "pass" | "warn" | "fail";
export type FindingStatus = "open" | "resolved";
export type Exploitability = "low" | "medium" | "high";
export type FindingImpact = "low" | "moderate" | "high" | "critical";
export type PlatformVerdict =
  | "pass"
  | "concern"
  | "fail"
  | "critical"
  | "not_comparable"
  | "accepted_risk"
  | "muted"
  | "resolved"
  | "inconclusive";

export type EvaluationRule = {
  id: string;
  version?: string;
  family?: string;
  label: string;
  outcome: "pass" | "fail" | "warn" | "info";
  message: string;
  conditionSummary?: string;
  matchedPattern?: string;
};

export type EvidenceRecord = {
  kind: "pattern" | "status" | "response" | "receipt" | "timing" | "comparison";
  label: string;
  value: string;
};

export type ConfidenceReason = {
  level: Confidence;
  explanation: string;
};

export type FindingLifecycle = "new" | "recurring" | "regressed" | "resolved" | "muted" | "accepted_risk";
export type FixVerificationState = "detected" | "fix_attempted" | "retested" | "verified_resolved";
export type TrustSignal =
  | "fully_executed"
  | "partially_executed"
  | "degraded_by_timeouts"
  | "degraded_by_errors"
  | "inconclusive_due_to_target_variance";

export type EvidenceSnapshot = {
  attackSummary: string;
  responseSummary: string;
  evaluatorSummary: string;
  confidenceSummary: string;
  whyItMatters: string;
};

export type SuppressionMetadata = {
  reason: string;
  timestamp: string;
  owner?: string;
  expiry?: string;
  reviewNote?: string;
  expired: boolean;
  governanceWarning?: string;
};

export type FindingWorkflowMetadata = {
  state: FixVerificationState;
  updatedAt: string;
  owner?: string;
  note?: string;
};

export type RemediationBlock = {
  whatToChange: string;
  whyItMatters: string;
  attackerBenefitIfUnfixed: string;
  retestSuggestion: string;
};

export type ThreatProfile = {
  intent: string;
  whyThisExists: string;
  expectedSafeBehavior: string;
  failureCriteria: string[];
};

export type RequestRecord = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  payloadFormat?: PayloadFormat | "json";
};

export type ResponseRecord = {
  status: number;
  headers: Record<string, string>;
  rawText: string;
  normalizedText: string;
  normalizedData: unknown;
};

export type TimelineEvent = {
  id: string;
  timestamp: string;
  phase:
    | "queued"
    | "request_sent"
    | "response_received"
    | "evaluation_completed"
    | "gateway_signal"
    | "routing"
    | "retry"
    | "completed"
    | "error";
  title: string;
  detail: string;
};

export type TransparencyRecord = {
  model?: string;
  provider?: string;
  tokensIn?: number;
  tokensOut?: number;
  estimatedCostUsd?: number;
  latencyMs?: number;
  serverDurationMs?: number;
  routingTier?: string;
  routingDecision?: string;
  modelRole?: string;
  escalated?: boolean;
  gatewayBlocked?: boolean;
  gatewayReason?: string;
  refusalSignal?: boolean;
  receiptId?: string;
  timeline: TimelineEvent[];
};

export type FingerprintEndpoint = {
  path: string;
  label: string;
  status: number;
  bytes: number;
  reachable: boolean;
  authRequired: boolean;
  headersOfInterest: Record<string, string>;
};

export type TargetFingerprint = {
  capturedAt: string;
  targetKey: string;
  targetName: string;
  baseUrl: string;
  reachableEndpoints: FingerprintEndpoint[];
  authPostureSummary: string;
  versionMetadata?: string;
  headersOfInterest: Record<string, string>;
  signature: string;
  reachableCount: number;
  totalEndpoints: number;
};

export type FingerprintComparison = {
  comparable: boolean;
  warning?: string;
  previousSignature?: string;
  changedFields: string[];
};

export type RunComparisonRecord = {
  previousTimestamp?: string;
  changed: boolean;
  previousResult?: ResultVerdict;
  summary: string;
  fingerprint?: FingerprintComparison;
  verdict?: PlatformVerdict;
};

export type ExecutionRecord = {
  state: ResultState;
  lastRunAt?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  attemptCount: number;
};

export type TestCase = {
  id: string;
  name: string;
  category: string;
  target: string;
  purpose: string;
  input: string;
  expectedBehavior: ExpectedBehavior;
  severity: Severity;
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
  request: RequestRecord;
  response: ResponseRecord;
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
  request: RequestRecord;
  response: ResponseRecord;
};

// --- Test result for reporting ---

export type TestResult = {
  testId: string;
  testName: string;
  category: string;
  target: string;
  purpose: string;
  timestamp: string;
  result: ResultVerdict;
  confidence: Confidence;
  observedBehavior: string;
  expectedBehavior: string;
  suggestedImprovements: string[];
  rawResponseSnippet: string;
  parsedFields: ParsedFields;
  retry: RetryInfo;
  durationMs: number;
  state?: ResultState;
  execution?: ExecutionRecord;
  normalizedVerdict?: PlatformVerdict;
  threatProfile?: ThreatProfile;
  request?: RequestRecord;
  response?: ResponseRecord;
  evaluatorRules?: EvaluationRule[];
  evidence?: EvidenceRecord[];
  evidenceSnapshot?: EvidenceSnapshot;
  confidenceReason?: ConfidenceReason;
  remediationGuidance?: string[];
  remediationBlock?: RemediationBlock;
  transparency?: TransparencyRecord;
  targetFingerprint?: TargetFingerprint;
  priorRunComparison?: RunComparisonRecord;
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

export type SuiteExecutionState = {
  suiteId: string;
  suiteName: string;
  category: string;
  state: ResultState;
  total: number;
  counts: Record<ResultState, number>;
  lastRunAt?: string;
  durationMs?: number;
};

export type FindingRecord = {
  id: string;
  title: string;
  category: string;
  severity: Severity;
  target: string;
  test_id: string;
  status: FindingStatus;
  lifecycle: FindingLifecycle;
  workflow_state?: FixVerificationState;
  workflow?: FindingWorkflowMetadata;
  suppression?: SuppressionMetadata;
  verdict?: PlatformVerdict;
  exploitability: Exploitability;
  impact: FindingImpact;
  confidence: Confidence;
  confidence_reason: string;
  evidence_summary: string;
  evidence_snapshot: EvidenceSnapshot;
  remediation_summary: string;
  remediation_block: RemediationBlock;
  provenance: EvaluationRule[];
  first_seen_at: string;
  last_seen_at: string;
  regression: boolean;
  occurrences: number;
};

export type GateRecord = {
  id: string;
  title: string;
  status: GateStatus;
  verdict?: PlatformVerdict;
  explanation: string;
  relatedCategories: string[];
  counts: {
    passed: number;
    failed: number;
    warned: number;
    blocked: number;
    notRun: number;
  };
};

export type RiskSummary = {
  overallVerdict: OverallVerdict;
  highestSeverityObserved: Severity | "none";
  exploitableFindingsCount: number;
  publicExposureFindingsCount: number;
  childSafetyFailuresCount: number;
  recommendedFirstFix: string;
};

export type RunDelta = {
  newFindings: FindingRecord[];
  recurringFindings: FindingRecord[];
  resolvedFindings: FindingRecord[];
  regressedFindings: FindingRecord[];
  unchangedFindings: FindingRecord[];
  notComparableFindings: FindingRecord[];
  previousRunAt?: string;
  comparabilityWarning?: string;
};

export type AssessmentMetrics = {
  totalRunDurationMs: number;
  perSuiteDurationMs: Record<string, number>;
  perTestDurationMs: Record<string, number>;
  timeoutCount: number;
  blockedCount: number;
  errorCount: number;
  averageResponseLatencyMs: number;
  totalEstimatedCostUsd?: number;
  criticalFindingsCount: number;
  newRegressionsCount: number;
  publicExposureCount: number;
  childSafetyFailuresCount: number;
};

export type ExecutionCoverage = {
  runTrustSignals: TrustSignal[];
  suiteTrustSignals: Record<string, TrustSignal[]>;
};

export type IntegrityRecord = {
  sequence: number;
  checksum: string;
  previousChecksum?: string;
  chainHash: string;
  status: "ok" | "genesis" | "warning";
  warning?: string;
};

export type OperatorSummary = {
  overallVerdict: PlatformVerdict;
  highestSeverity: Severity | "none";
  criticalFindingsCount: number;
  newRegressionsCount: number;
  publicExposureCount: number;
  childSafetyFailuresCount: number;
  recommendedFirstFix: string;
  keyEvidenceHighlights: string[];
  trustSignals: TrustSignal[];
  exportActions: Array<{ label: string; path: string }>;
};

export type DashboardAssessment = {
  generatedAt: string;
  target: string;
  targetName?: string;
  summary: {
    total: number;
    pass: number;
    fail: number;
    warn: number;
  };
  verdict: PlatformVerdict;
  riskSummary: RiskSummary;
  operatorSummary: OperatorSummary;
  metrics: AssessmentMetrics;
  coverage: ExecutionCoverage;
  integrity?: IntegrityRecord;
  targetFingerprint?: TargetFingerprint;
  gates: GateRecord[];
  findings: FindingRecord[];
  suites: SuiteExecutionState[];
  tests: TestResult[];
  comparison: RunDelta;
};
