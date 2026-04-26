(function initVerumApi(globalScope) {
  "use strict";

  function parseBodyText(rawText) {
    if (!rawText) return null;
    try {
      return JSON.parse(rawText);
    } catch {
      return null;
    }
  }

  function summarizeRawError(rawText) {
    if (!rawText) return "";
    const trimmed = rawText.trim();
    if (!trimmed) return "";

    const preMatch = trimmed.match(/<pre>([\s\S]*?)<\/pre>/i);
    if (preMatch && preMatch[1] && preMatch[1].trim()) {
      return preMatch[1].trim();
    }

    if (/^<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed)) {
      return "";
    }

    return trimmed;
  }

  function buildErrorMessage(payload) {
    if (payload.data && typeof payload.data === "object" && typeof payload.data.error === "string" && payload.data.error.trim()) {
      return payload.data.error.trim();
    }
    const summarizedRaw = summarizeRawError(payload.raw);
    if (summarizedRaw) {
      return summarizedRaw;
    }
    if (payload.status) {
      return "Request failed with status " + payload.status + (payload.statusText ? " (" + payload.statusText + ")" : "");
    }
    return "Request failed";
  }

  async function readApiResponse(response) {
    const raw = await response.text();
    const data = parseBodyText(raw);
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText || "",
      raw,
      data,
    };
  }

  async function apiFetch(path, opts) {
    const normalized = await readApiResponse(await fetch("/api" + path, opts));
    if (!normalized.ok) {
      const error = new Error(buildErrorMessage(normalized));
      error.status = normalized.status;
      error.payload = normalized;
      throw error;
    }
    if (normalized.data !== null) return normalized.data;
    if (!normalized.raw) return {};
    throw new Error("Expected JSON response body but received non-JSON text.");
  }

  const apiClient = {
    apiFetch: apiFetch,
    buildErrorMessage: buildErrorMessage,
    parseBodyText: parseBodyText,
    readApiResponse: readApiResponse,
    summarizeRawError: summarizeRawError,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = apiClient;
  }

  globalScope.VerumApi = apiClient;
})(typeof window !== "undefined" ? window : globalThis);
