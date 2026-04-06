import axios from "axios";
import { ChatResult, SquidleyReceipt, RetryInfo, TargetConfig, EndpointResult, RequestRecord, ResponseRecord } from "./types";
import { resolvePathForAlias } from "./targets";

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// --- SSE stream parsing ---

type SSEEvent = {
  type?: string;
  [key: string]: unknown;
};

function parseSSE(raw: string): { events: SSEEvent[]; rawText: string } {
  const events: SSEEvent[] = [];
  const lines = raw.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;

    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") continue;

    try {
      const parsed = JSON.parse(payload) as SSEEvent;
      events.push(parsed);
    } catch {
      // non-JSON data line, skip
    }
  }

  return { events, rawText: raw };
}

function extractFromSSE(events: SSEEvent[]): {
  text: string;
  result: Record<string, unknown> | null;
  error: string | null;
} {
  let text = "";
  let result: Record<string, unknown> | null = null;
  let error: string | null = null;

  for (const event of events) {
    if ((event.type === "token" || event.type === "chunk") && typeof event.text === "string") {
      text += event.text;
    }
    if (event.type === "done" && event.result && typeof event.result === "object") {
      result = event.result as Record<string, unknown>;
      // The done event's result.text has the full output
      if (typeof result.text === "string" && result.text) {
        text = result.text;
      }
    }
    if (event.type === "error" && typeof event.error === "string") {
      error = event.error;
    }
  }

  return { text, result, error };
}

// --- Receipt parsing ---

function parseReceiptFromV2Result(result: Record<string, unknown> | null, events: SSEEvent[]): SquidleyReceipt | null {
  if (!result && events.length === 0) return null;

  const receipt: SquidleyReceipt = {};

  if (result) {
    if (typeof result.text === "string") receipt.output = result.text;
    if (typeof result.model === "string") receipt.model = result.model;
    if (typeof result.provider === "string") receipt.provider = result.provider;
    if (typeof result.tokensIn === "number") receipt.tokensIn = result.tokensIn;
    if (typeof result.tokensOut === "number") receipt.tokensOut = result.tokensOut;
    if (typeof result.estimatedCostUsd === "number") receipt.estimatedCostUsd = result.estimatedCostUsd;
    if (typeof result.durationMs === "number") receipt.serverDurationMs = result.durationMs;

    if (result.meta && typeof result.meta === "object") {
      const meta = result.meta as Record<string, unknown>;
      receipt.active_model = {
        provider: typeof meta.provider === "string" ? meta.provider : undefined,
        model: receipt.model,
      };
    }
  }

  // Check for routing info from the done event
  const doneEvent = events.find((e) => e.type === "done");
  if (doneEvent) {
    if (typeof doneEvent.routingDecisionId === "string") receipt.receipt_id = doneEvent.routingDecisionId;
    if (typeof doneEvent.routingTaskType === "string") receipt.tier = doneEvent.routingTaskType;
    if (typeof doneEvent.modelRole === "string") receipt.modelRole = doneEvent.modelRole;
  }

  // Check for gateway/error info
  const errorEvent = events.find((e) => e.type === "error");
  if (errorEvent && typeof errorEvent.error === "string") {
    receipt.error = errorEvent.error;
  }

  // Check for guard events (gateway blocks)
  const guardEvent = events.find((e) => e.type === "guard" || e.type === "blocked");
  if (guardEvent) {
    if (typeof guardEvent.reason === "string") receipt.reason = guardEvent.reason;
    if (typeof guardEvent.error === "string") receipt.error = guardEvent.error;
  }

  return receipt;
}

function parseReceiptFromV1(data: unknown): SquidleyReceipt | null {
  if (data === null || data === undefined) return null;
  if (typeof data !== "object") return null;

  const obj = data as Record<string, unknown>;
  const receipt: SquidleyReceipt = {};

  if (typeof obj.output === "string") receipt.output = obj.output;
  if (typeof obj.receipt_id === "string") receipt.receipt_id = obj.receipt_id;
  if (typeof obj.provider === "string") receipt.provider = obj.provider;
  if (typeof obj.model === "string") receipt.model = obj.model;
  if (typeof obj.tier === "string") receipt.tier = obj.tier;
  if (typeof obj.escalated === "boolean") receipt.escalated = obj.escalated;
  if (typeof obj.error === "string") receipt.error = obj.error;
  if (typeof obj.reason === "string") receipt.reason = obj.reason;

  if (obj.active_model && typeof obj.active_model === "object") {
    const am = obj.active_model as Record<string, unknown>;
    receipt.active_model = {
      provider: typeof am.provider === "string" ? am.provider : undefined,
      model: typeof am.model === "string" ? am.model : undefined,
    };
  }

  if (obj.context && typeof obj.context === "object") {
    const ctx = obj.context as Record<string, unknown>;
    receipt.context = {
      used: typeof ctx.used === "boolean" ? ctx.used : undefined,
    };
  }

  if (Array.isArray(obj.memory_hits)) {
    receipt.memory_hits = obj.memory_hits;
  }

  return receipt;
}

// --- Transient error detection ---

function isTransientError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const code = error.code ?? "";
  return (
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    error.response?.status === 502 ||
    error.response?.status === 503 ||
    error.response?.status === 504
  );
}

// --- Request execution ---

function buildPayload(target: TargetConfig, input: string): unknown {
  if (target.payloadFormat === "messages") {
    return { messages: [{ role: "user", content: input }] };
  }
  return { input };
}

function buildAuthHeaders(target: TargetConfig): Record<string, string> {
  const headerName = target.auth?.headerName?.trim();
  const token = target.auth?.token;
  if (!headerName || !token) return {};
  return { [headerName]: token };
}

function buildResponseRecord(status: number, headers: Record<string, string>, rawText: string, data: unknown): ResponseRecord {
  let normalizedData: unknown = data;
  if (typeof normalizedData === "string") {
    try {
      normalizedData = JSON.parse(normalizedData);
    } catch {
      normalizedData = normalizedData;
    }
  }

  const normalizedText = typeof normalizedData === "string"
    ? normalizedData
    : stringifyUnknown(normalizedData);

  return {
    status,
    headers,
    rawText,
    normalizedText,
    normalizedData,
  };
}

type AttemptResult = {
  ok: boolean;
  status: number;
  data: unknown;
  rawText: string;
  isSSE: boolean;
  headers: Record<string, string>;
  error?: unknown;
};

async function attemptChat(
  url: string,
  payload: unknown,
  timeout: number,
  authHeaders: Record<string, string>
): Promise<AttemptResult> {
  try {
    const response = await axios.post(url, payload, {
      timeout,
      validateStatus: () => true,
      headers: { "content-type": "application/json", ...authHeaders },
      // Accept text to handle SSE streams that come back as text
      responseType: "text",
      transformResponse: [(data: unknown) => data],
    });

    const rawText = typeof response.data === "string" ? response.data : stringifyUnknown(response.data);
    const contentType = (response.headers["content-type"] ?? "") as string;
    const isSSE = contentType.includes("text/event-stream") || rawText.trimStart().startsWith("data:");
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(response.headers)) {
      headers[k] = String(v);
    }

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      data: response.data,
      rawText,
      isSSE,
      headers,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      status: axios.isAxiosError(error) ? (error.response?.status ?? 0) : 0,
      data: axios.isAxiosError(error)
        ? { message: error.message, code: error.code ?? null, status: error.response?.status ?? null, data: error.response?.data ?? null }
        : { message: error instanceof Error ? error.message : "Unknown request error" },
      rawText: "",
      isSSE: false,
      headers: {},
      error,
    };
  }
}

// --- Public API ---

export async function sendChat(
  target: TargetConfig,
  input: string,
  timeout = 30000
): Promise<ChatResult> {
  const chatPath = resolvePathForAlias(target as never, "chat") || target.chatPath || (target.pathMode === "explicit_plus_defaults" ? "/chat" : undefined);
  if (!chatPath) {
    throw new Error("Target configuration does not define a chat endpoint path.");
  }
  const authHeaders = buildAuthHeaders(target);
  const url = `${target.baseUrl}${chatPath}`;
  const payload = buildPayload(target, input);
  const request: RequestRecord = {
    url,
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders },
    body: payload,
    payloadFormat: target.payloadFormat,
  };
  const start = Date.now();
  const retry: RetryInfo = { attempted: false };

  let result = await attemptChat(url, payload, timeout, authHeaders);

  // Retry once on transient failure
  if (result.error && isTransientError(result.error)) {
    const errMsg = result.error instanceof Error ? result.error.message : String(result.error);
    retry.attempted = true;
    retry.reason = "transient_failure";
    retry.originalError = errMsg;
    result = await attemptChat(url, payload, timeout, authHeaders);
  }

  if (!result.rawText && result.data) {
    result.rawText = stringifyUnknown(result.data);
  }

  const durationMs = Date.now() - start;

  // Parse receipt based on response format
  let receipt: SquidleyReceipt | null;

  if (result.isSSE) {
    const { events } = parseSSE(result.rawText);
    const extracted = extractFromSSE(events);
    receipt = parseReceiptFromV2Result(extracted.result, events);

    // Ensure assembled chunk text is stored as output even if done.result.text was empty
    if (receipt && extracted.text && !receipt.output) {
      receipt.output = extracted.text;
    }

    // If SSE had an error event, reflect it in receipt
    if (extracted.error && receipt) {
      receipt.error = receipt.error ?? extracted.error;
    }
  } else {
    // Try parsing as JSON for V1-style responses
    let parsed = result.data;
    if (typeof parsed === "string") {
      try { parsed = JSON.parse(parsed); } catch { /* keep as string */ }
    }
    receipt = parseReceiptFromV1(parsed);
  }

  return {
    ok: result.ok,
    status: result.status,
    data: result.data,
    rawText: result.rawText,
    receipt,
    retry,
    durationMs,
    request,
    response: buildResponseRecord(result.status, result.headers, result.rawText, result.data),
  };
}

// --- Generic endpoint request (for non-chat endpoint testing) ---

export async function sendRequest(
  baseUrl: string,
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "DELETE" | "OPTIONS" = "GET",
  body?: unknown,
  headers?: Record<string, string>,
  timeout = 15000
): Promise<EndpointResult> {
  const url = `${baseUrl}${endpoint}`;
  const requestHeaders = {
    "content-type": "application/json",
    ...(headers ?? {}),
  };
  const start = Date.now();
  const retry: RetryInfo = { attempted: false };

  const doAttempt = async (): Promise<{ ok: boolean; status: number; headers: Record<string, string>; data: unknown; rawText: string; error?: unknown }> => {
    try {
      const response = await axios({
        method,
        url,
        data: body,
        timeout,
        validateStatus: () => true,
        headers: {
          ...requestHeaders,
        },
        responseType: "text",
        transformResponse: [(data: unknown) => data],
      });

      const rawText = typeof response.data === "string" ? response.data : stringifyUnknown(response.data);
      const respHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(response.headers)) {
        respHeaders[k] = String(v);
      }

      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        headers: respHeaders,
        data: response.data,
        rawText,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        status: axios.isAxiosError(error) ? (error.response?.status ?? 0) : 0,
        headers: {},
        data: { message: error instanceof Error ? error.message : "Unknown error" },
        rawText: "",
        error,
      };
    }
  };

  let result = await doAttempt();

  if (result.error && isTransientError(result.error)) {
    retry.attempted = true;
    retry.reason = "transient_failure";
    retry.originalError = result.error instanceof Error ? result.error.message : String(result.error);
    result = await doAttempt();
  }

  return {
    ok: result.ok,
    status: result.status,
    headers: result.headers,
    data: result.data,
    rawText: result.rawText,
    durationMs: Date.now() - start,
    retry,
    request: {
      url,
      method,
      headers: requestHeaders,
      body,
      payloadFormat: "json",
    },
    response: buildResponseRecord(result.status, result.headers, result.rawText, result.data),
  };
}
