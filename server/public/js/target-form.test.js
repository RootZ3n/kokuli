const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeTargetPayload, validateTargetPayload } = require("./target-form.js");

test("normalizeTargetPayload serializes baseUrl and omits blank optional fields", () => {
  const payload = normalizeTargetPayload({
    id: " demo-target ",
    name: " Demo Target ",
    baseUrl: " https://example.test/api ",
    endpoints: {
      chat: " /chat ",
      health: " ",
    },
    auth: {
      headerName: " authorization ",
      token: "",
    },
    notes: " demo notes ",
  }, { includeId: true });

  assert.deepEqual(payload, {
    id: "demo-target",
    name: "Demo Target",
    baseUrl: "https://example.test/api",
    payloadFormat: "messages",
    pathMode: "explicit_plus_defaults",
    endpoints: {
      chat: "/chat",
    },
    auth: {
      headerName: "authorization",
    },
    notes: "demo notes",
    enabled: true,
  });
});

test("validateTargetPayload reports operator-facing field errors", () => {
  assert.equal(validateTargetPayload({ id: "", name: "", baseUrl: "" }, { requireId: true }), "Target id is required.");
  assert.equal(validateTargetPayload({ id: "demo", name: "", baseUrl: "" }, { requireId: true }), "Target name is required.");
  assert.equal(validateTargetPayload({ id: "demo", name: "Demo", baseUrl: "" }, { requireId: true }), "Base URL is required.");
  assert.equal(validateTargetPayload({ id: "demo", name: "Demo", baseUrl: "not-a-url" }, { requireId: true }), "Base URL must be a valid URL.");
});
