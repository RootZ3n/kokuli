import axios from "axios";
import { ChatResult, SquidleyReceipt, RetryInfo, TargetConfig } from "./types";

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseReceipt(data: unknown): SquidleyReceipt | null {
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

async function attemptChat(
  url: string,
  input: string,
  timeout: number
): Promise<{ ok: boolean; status: number; data: unknown; rawText: string; error?: unknown }> {
  try {
    const response = await axios.post(
      url,
      { input },
      {
        timeout,
        validateStatus: () => true,
        headers: { "content-type": "application/json" },
      }
    );
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      data: response.data,
      rawText: stringifyUnknown(response.data),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      status: axios.isAxiosError(error) ? (error.response?.status ?? 0) : 0,
      data: axios.isAxiosError(error)
        ? { message: error.message, code: error.code ?? null, status: error.response?.status ?? null, data: error.response?.data ?? null }
        : { message: error instanceof Error ? error.message : "Unknown request error" },
      rawText: "",
      error,
    };
  }
}

export async function sendChat(
  target: TargetConfig,
  input: string,
  timeout = 30000
): Promise<ChatResult> {
  const url = `${target.baseUrl}${target.chatPath}`;
  const start = Date.now();
  const retry: RetryInfo = { attempted: false };

  let result = await attemptChat(url, input, timeout);

  // Retry once on transient failure
  if (result.error && isTransientError(result.error)) {
    const errMsg = result.error instanceof Error ? result.error.message : String(result.error);
    retry.attempted = true;
    retry.reason = "transient_failure";
    retry.originalError = errMsg;

    result = await attemptChat(url, input, timeout);
  }

  if (!result.rawText && result.data) {
    result.rawText = stringifyUnknown(result.data);
  }

  const durationMs = Date.now() - start;
  const receipt = parseReceipt(result.data);

  return {
    ok: result.ok,
    status: result.status,
    data: result.data,
    rawText: result.rawText,
    receipt,
    retry,
    durationMs,
  };
}
