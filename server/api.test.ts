import test from "node:test";
import assert from "node:assert/strict";
import { opsTokenMatches } from "./api";
import { apiErrorHandler } from "./api-errors";

test("ops token gate allows requests when VERUM_API_TOKEN is unset", () => {
  assert.equal(opsTokenMatches({}, undefined), true);
});

test("ops token gate requires x-verum-api-token when configured", () => {
  assert.equal(opsTokenMatches({}, "secret-token"), false);
  assert.equal(opsTokenMatches({ "x-verum-api-token": "wrong" }, "secret-token"), false);
  assert.equal(opsTokenMatches({ "x-verum-api-token": "secret-token" }, "secret-token"), true);
});

test("ops token gate accepts bearer token when configured", () => {
  assert.equal(opsTokenMatches({ authorization: "Bearer secret-token" }, "secret-token"), true);
  assert.equal(opsTokenMatches({ authorization: "Bearer wrong" }, "secret-token"), false);
});

function fakeResponse() {
  return {
    statusCode: 0,
    payload: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.headers["content-type"] = "application/json; charset=utf-8";
      this.payload = payload;
      return this;
    },
  };
}

test("malformed JSON to /api/ops/run returns sanitized JSON", () => {
  const err = new SyntaxError("Unexpected token p in JSON at position 1") as SyntaxError & { status?: number; type?: string; body?: string };
  err.status = 400;
  err.type = "entity.parse.failed";
  err.body = "profile:break_me";

  const req = { method: "POST", path: "/api/ops/run" };
  const res = fakeResponse();
  let nextCalled = false;

  apiErrorHandler(err, req as never, res as never, () => { nextCalled = true; });

  const body = JSON.stringify(res.payload);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.deepEqual(res.payload, {
    ok: false,
    error: "invalid_json",
    message: "Request body must be valid JSON.",
  });
  assert.doesNotMatch(body, /SyntaxError|Unexpected token|\/mnt\/ai|\/home\/zen|server\/index|body-parser|stack/i);
});

test("malformed JSON to another API route returns the same safe envelope", () => {
  const err = new SyntaxError("Unexpected end of JSON input") as SyntaxError & { status?: number; type?: string };
  err.status = 400;
  err.type = "entity.parse.failed";

  const req = { method: "POST", path: "/api/targets" };
  const res = fakeResponse();

  apiErrorHandler(err, req as never, res as never, () => {
    throw new Error("next should not be called for API parse errors");
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.deepEqual(res.payload, {
    ok: false,
    error: "invalid_json",
    message: "Request body must be valid JSON.",
  });
});

test("API error handler leaves non-API routes to the normal handler", () => {
  const err = new Error("non-api");
  const req = { method: "GET", path: "/atlantis" };
  const res = fakeResponse();
  let forwarded: unknown;

  apiErrorHandler(err, req as never, res as never, (nextErr) => { forwarded = nextErr; });

  assert.equal(forwarded, err);
  assert.equal(res.statusCode, 0);
  assert.equal(res.payload, undefined);
});
