(function initKrakzenTargetForm(globalScope) {
  "use strict";

  function normalizeTargetPayload(raw, options) {
    const opts = options || {};
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : "";
    const endpoints = Object.entries(raw.endpoints || {}).reduce((acc, entry) => {
      const key = entry[0];
      const value = typeof entry[1] === "string" ? entry[1].trim() : "";
      if (value) acc[key] = value;
      return acc;
    }, {});
    const authHeader = raw.auth && typeof raw.auth.headerName === "string" ? raw.auth.headerName.trim() : "";
    const authToken = raw.auth && typeof raw.auth.token === "string" ? raw.auth.token : "";
    const normalized = {
      name,
      baseUrl,
      payloadFormat: raw.payloadFormat || "messages",
      pathMode: raw.pathMode || "explicit_plus_defaults",
      endpoints,
      auth: {},
      notes: typeof raw.notes === "string" ? raw.notes.trim() : "",
      enabled: raw.enabled !== false,
    };
    if (opts.includeId) normalized.id = id;
    if (authHeader) normalized.auth.headerName = authHeader;
    if (authToken && authToken.trim()) normalized.auth.token = authToken;
    if (!Object.keys(normalized.auth).length) delete normalized.auth;
    if (!Object.keys(normalized.endpoints).length) delete normalized.endpoints;
    if (!normalized.notes) delete normalized.notes;
    return normalized;
  }

  function validateTargetPayload(payload, options) {
    const opts = options || {};
    if (opts.requireId && !payload.id) return "Target id is required.";
    if (!payload.name) return "Target name is required.";
    if (!payload.baseUrl) return "Base URL is required.";
    try {
      new URL(payload.baseUrl);
    } catch {
      return "Base URL must be a valid URL.";
    }
    return "";
  }

  const api = {
    normalizeTargetPayload: normalizeTargetPayload,
    validateTargetPayload: validateTargetPayload,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalScope.KrakzenTargetForm = api;
})(typeof window !== "undefined" ? window : globalThis);
