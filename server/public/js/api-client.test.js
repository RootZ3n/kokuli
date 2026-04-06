const test = require("node:test");
const assert = require("node:assert/strict");
const { readApiResponse, buildErrorMessage, apiFetch, summarizeRawError } = require("./api-client.js");

function makeResponse(options) {
  let reads = 0;
  return {
    ok: options.ok,
    status: options.status,
    statusText: options.statusText || "",
    async text() {
      reads += 1;
      return options.body;
    },
    get reads() {
      return reads;
    },
  };
}

test("readApiResponse consumes the response body exactly once and parses JSON", async () => {
  const response = makeResponse({
    ok: true,
    status: 200,
    body: JSON.stringify({ ok: true, value: 7 }),
  });

  const normalized = await readApiResponse(response);

  assert.equal(response.reads, 1);
  assert.equal(normalized.status, 200);
  assert.deepEqual(normalized.data, { ok: true, value: 7 });
  assert.equal(normalized.raw, '{"ok":true,"value":7}');
});

test("buildErrorMessage prefers JSON error then raw text then status fallback", () => {
  assert.equal(
    buildErrorMessage({ status: 400, statusText: "Bad Request", raw: '{"error":"boom"}', data: { error: "boom" } }),
    "boom",
  );
  assert.equal(
    buildErrorMessage({ status: 500, statusText: "Server Error", raw: "plain failure", data: null }),
    "plain failure",
  );
  assert.equal(
    buildErrorMessage({ status: 404, statusText: "Not Found", raw: "", data: null }),
    "Request failed with status 404 (Not Found)",
  );
});

test("summarizeRawError extracts useful text from HTML error pages", () => {
  assert.equal(
    summarizeRawError("<!DOCTYPE html><html><body><pre>Cannot GET /api/dashboard</pre></body></html>"),
    "Cannot GET /api/dashboard",
  );
  assert.equal(summarizeRawError("plain failure"), "plain failure");
});

test("apiFetch handles JSON success, text error, and empty success without double reads", async () => {
  const responses = [
    makeResponse({ ok: true, status: 200, body: '{"status":"ok"}' }),
    makeResponse({ ok: false, status: 502, statusText: "Bad Gateway", body: "upstream failure" }),
    makeResponse({ ok: true, status: 204, statusText: "No Content", body: "" }),
  ];
  let fetchIndex = 0;
  global.fetch = async function fetchStub() {
    const next = responses[fetchIndex];
    fetchIndex += 1;
    return next;
  };

  const success = await apiFetch("/demo");
  assert.deepEqual(success, { status: "ok" });
  assert.equal(responses[0].reads, 1);

  await assert.rejects(
    () => apiFetch("/demo"),
    (error) => error.message === "upstream failure" && error.status === 502,
  );
  assert.equal(responses[1].reads, 1);

  const empty = await apiFetch("/demo");
  assert.deepEqual(empty, {});
  assert.equal(responses[2].reads, 1);
});
