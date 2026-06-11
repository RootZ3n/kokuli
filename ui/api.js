// ══════════════════════════════════════════════════════════════════════
// KOKULI · ui/api.js — API client for The Investigation
// ──────────────────────────────────────────────────────────────────────
// Talks to the Kokuli backend (the private-investigator server) on
// port 18800. The UI is served by that same server, so calls are
// SAME-ORIGIN by default (relative `/api/...`) which keeps them inside the
// server's `connect-src 'self'` CSP. Override with window.KOKULI_API_BASE
// only if you split the UI onto a different origin (and relax CSP there).
//
// Every method resolves to a normalized envelope — it NEVER throws and
// NEVER rejects:
//     { ok: true,  data: <parsed body>,        error: null }
//     { ok: false, data: <parsed body|null>,   error: "<message>", status }
// so callers can branch on `res.ok` without try/catch ceremony.
// ══════════════════════════════════════════════════════════════════════
(function initKokuliWorldApi(global) {
  "use strict";

  // Same-origin by default. A trailing slash is trimmed so `BASE + "/api"`
  // is always well formed.
  function resolveBase() {
    const override = global.KOKULI_API_BASE;
    if (typeof override === "string" && override.trim()) {
      return override.trim().replace(/\/+$/, "");
    }
    return ""; // relative → same origin as the served page (port 18800)
  }

  const BASE = resolveBase();

  // Parse a response body as JSON when possible; fall back to the raw text.
  async function readBody(response) {
    const raw = await response.text();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw; // non-JSON (e.g. an HTML error page) — return as-is
    }
  }

  // Pull a human-readable message out of a failed response.
  function errorMessage(status, statusText, body) {
    if (body && typeof body === "object" && typeof body.error === "string" && body.error.trim()) {
      return body.error.trim();
    }
    if (typeof body === "string" && body.trim() && !/^\s*</.test(body)) {
      return body.trim().slice(0, 300);
    }
    if (status) return `Request failed (${status}${statusText ? " " + statusText : ""})`;
    return "Request failed";
  }

  function ok(data) {
    return { ok: true, data, error: null, status: 200 };
  }
  function fail(error, status, data) {
    return { ok: false, data: data ?? null, error, status: status ?? 0 };
  }

  // Core request. Resolves to the normalized envelope for ALL outcomes,
  // including network failure (no throw).
  async function request(method, path, body) {
    const url = BASE + "/api" + path;
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetch(url, opts);
    } catch (err) {
      // Network/DNS/CORS failure — the server is likely down or unreachable.
      return fail(
        "Cannot reach Kokuli on " + (BASE || "this origin") + " — is the server running on port 18800?",
        0
      );
    }
    const parsed = await readBody(response);
    if (!response.ok) {
      return fail(errorMessage(response.status, response.statusText, parsed), response.status, parsed);
    }
    return ok(parsed);
  }

  const get = (path) => request("GET", path);
  const post = (path, body) => request("POST", path, body);
  const del = (path) => request("DELETE", path);

  // ── Public surface — one method per backend endpoint the UI needs ──────
  const api = {
    base: BASE,

    // Health & process
    health: () => request("GET", ""), // /health lives off /api → handled below
    meta: () => get("/meta"),
    logs: (limit) => get("/meta/logs" + (limit ? "?limit=" + encodeURIComponent(limit) : "")),

    // Case Overview / Fracture Map — the assessment bundle + run summary
    dashboard: () => get("/dashboard"),
    summary: () => get("/reports/summary"),
    latestReports: () => get("/reports/latest"),

    // Pressure Tests — the test registry + execution
    tests: () => get("/tests"),
    runTest: (id, payload) => post("/tests/" + encodeURIComponent(id) + "/run", payload || {}),
    runSuite: (category, payload) => post("/suite/" + encodeURIComponent(category), payload || {}),

    // Live Monitoring — Armory ops + server logs
    opsStatus: () => get("/ops/status"),

    // Evidence & Records — the transparency ledger
    transparency: () => get("/transparency"),

    // Targets — who Kokuli is interrogating
    targets: () => get("/targets"),

    // Bridge — cross-repo run history
    bridgeRuns: (limit) => get("/bridge/runs" + (limit ? "?limit=" + encodeURIComponent(limit) : "")),
  };

  // /health is served at the server root (NOT under /api), so it bypasses
  // the /api rate limiter. Use it for the lightweight status-dot heartbeat.
  api.health = async function health() {
    const url = BASE + "/health";
    try {
      const response = await fetch(url, { method: "GET" });
      const body = await readBody(response);
      if (!response.ok) return fail(errorMessage(response.status, response.statusText, body), response.status, body);
      return ok(body);
    } catch {
      return fail("offline", 0);
    }
  };

  global.KokuliAPI = api;
})(typeof window !== "undefined" ? window : globalThis);
