import test from "node:test";
import assert from "node:assert/strict";
import { apiTokenMatches, isLoopbackAddress, requireLocalAccess } from "./access";

test("isLoopbackAddress allows localhost forms and rejects broad addresses", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("0.0.0.0"), false);
  assert.equal(isLoopbackAddress("192.168.1.10"), false);
});

test("reports and ops token helper blocks missing token when configured", () => {
  assert.equal(apiTokenMatches({}, undefined), true);
  assert.equal(apiTokenMatches({}, "secret-token"), false);
  assert.equal(apiTokenMatches({ "x-verum-api-token": "secret-token" }, "secret-token"), true);
});

function fakeResponse() {
  return {
    statusCode: 0,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
}

test("reports access gate rejects non-local requests and configured missing tokens", () => {
  const previousToken = process.env.VERUM_API_TOKEN;

  try {
    delete process.env.VERUM_API_TOKEN;
    const remoteRes = fakeResponse();
    const remoteReq = {
      ip: "192.168.1.20",
      socket: { remoteAddress: "192.168.1.20" },
      headers: {},
    };
    assert.equal(requireLocalAccess(remoteReq as never, remoteRes as never, "Reports"), false);
    assert.equal(remoteRes.statusCode, 403);

    process.env.VERUM_API_TOKEN = "secret-token";
    const missingTokenRes = fakeResponse();
    const localReq = {
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      headers: {},
    };
    assert.equal(requireLocalAccess(localReq as never, missingTokenRes as never, "Reports"), false);
    assert.equal(missingTokenRes.statusCode, 403);

    const allowedRes = fakeResponse();
    const tokenReq = {
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      headers: { "x-verum-api-token": "secret-token" },
    };
    assert.equal(requireLocalAccess(tokenReq as never, allowedRes as never, "Reports"), true);
    assert.equal(allowedRes.statusCode, 0);
  } finally {
    if (previousToken === undefined) {
      delete process.env.VERUM_API_TOKEN;
    } else {
      process.env.VERUM_API_TOKEN = previousToken;
    }
  }
});
