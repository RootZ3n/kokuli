import test from "node:test";
import assert from "node:assert/strict";
import {
  assertNetworkAllowed,
  isPrivateOrLocalHostname,
  NetworkGateError,
  wouldBeAllowed,
} from "./networkGate";

// Capture and restore env so tests can set/unset gate flags freely.
const SNAPSHOT_KEYS = [
  "KOKULI_ENABLE_NETWORK_OPS",
  "VERUM_ENABLE_NETWORK_OPS",
  "KOKULI_OWNERSHIP_CONFIRMED",
  "VERUM_OWNERSHIP_CONFIRMED",
  "KOKULI_NETWORK_BYPASS",
  "VERUM_NETWORK_BYPASS",
];
function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of SNAPSHOT_KEYS) snap[k] = process.env[k];
  return snap;
}
function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
function clearGateEnv(): void {
  for (const k of SNAPSHOT_KEYS) delete process.env[k];
}

test("isPrivateOrLocalHostname recognizes loopback / RFC1918 / CGNAT / IPv6 / mDNS", () => {
  for (const h of [
    "localhost",
    "127.0.0.1",
    "127.10.0.1",
    "10.0.0.1",
    "10.255.255.254",
    "192.168.1.1",
    "172.16.0.1",
    "172.31.255.254",
    "100.64.0.1", // CGNAT (Tailscale)
    "100.118.60.13",
    "169.254.1.1", // link-local
    "::1",
    "[::1]",
    "fe80::1",
    "fd00::1",
    "fc00::1",
    "my-host.local",
    "service.localhost",
  ]) {
    assert.equal(isPrivateOrLocalHostname(h), true, `expected ${h} to be private/local`);
  }
});

test("isPrivateOrLocalHostname rejects public hosts", () => {
  for (const h of [
    "8.8.8.8",
    "1.1.1.1",
    "172.15.0.1", // outside 172.16/12
    "172.32.0.1", // outside 172.16/12
    "100.63.0.1", // outside CGNAT
    "100.128.0.1", // outside CGNAT
    "11.0.0.1", // not 10/8
    "google.com",
    "api.openai.com",
    "example.com",
    "2001:db8::1",
  ]) {
    assert.equal(isPrivateOrLocalHostname(h), false, `expected ${h} to be public`);
  }
});

test("assertNetworkAllowed: private targets pass without env flags", () => {
  const snap = snapshotEnv();
  clearGateEnv();
  try {
    assertNetworkAllowed({ url: "http://127.0.0.1:8080/chat" });
    assertNetworkAllowed({ url: "http://localhost:3000" });
    assertNetworkAllowed({ url: "http://192.168.1.50/api" });
    assertNetworkAllowed({ url: "http://100.118.60.13:18791/chat" });
    assertNetworkAllowed({ url: "https://my-host.local/" });
  } finally {
    restoreEnv(snap);
  }
});

test("assertNetworkAllowed: public target refused without BOTH env flags", () => {
  const snap = snapshotEnv();
  try {
    clearGateEnv();
    assert.throws(
      () => assertNetworkAllowed({ url: "https://api.openai.com/v1/chat" }),
      (err: unknown) =>
        err instanceof NetworkGateError &&
        /KOKULI_ENABLE_NETWORK_OPS=1/.test(err.message) &&
        /KOKULI_OWNERSHIP_CONFIRMED=1/.test(err.message),
    );

    // Only one flag set (KOKULI_ variant): still refused.
    process.env.KOKULI_ENABLE_NETWORK_OPS = "1";
    assert.throws(
      () => assertNetworkAllowed({ url: "https://api.openai.com/v1/chat" }),
      (err: unknown) =>
        err instanceof NetworkGateError &&
        /KOKULI_OWNERSHIP_CONFIRMED=1/.test(err.message) &&
        !/KOKULI_ENABLE_NETWORK_OPS=1/.test(err.message),
    );

    // Both flags set: passes.
    process.env.KOKULI_OWNERSHIP_CONFIRMED = "1";
    assertNetworkAllowed({ url: "https://api.openai.com/v1/chat" });
  } finally {
    restoreEnv(snap);
  }
});

test("assertNetworkAllowed: env var typo still refuses (strict truthy values only)", () => {
  const snap = snapshotEnv();
  try {
    clearGateEnv();
    process.env.KOKULI_ENABLE_NETWORK_OPS = "tru"; // typo
    process.env.KOKULI_OWNERSHIP_CONFIRMED = "1";
    assert.throws(
      () => assertNetworkAllowed({ url: "https://api.openai.com/" }),
      NetworkGateError,
    );
    process.env.KOKULI_ENABLE_NETWORK_OPS = "0";
    assert.throws(
      () => assertNetworkAllowed({ url: "https://api.openai.com/" }),
      NetworkGateError,
    );
    process.env.KOKULI_ENABLE_NETWORK_OPS = "";
    assert.throws(
      () => assertNetworkAllowed({ url: "https://api.openai.com/" }),
      NetworkGateError,
    );
  } finally {
    restoreEnv(snap);
  }
});

test("assertNetworkAllowed: malformed URL is refused with a clear message", () => {
  assert.throws(
    () => assertNetworkAllowed({ url: "not a url" }),
    (err: unknown) => err instanceof NetworkGateError && /malformed URL/.test(err.message),
  );
});

test("assertNetworkAllowed: non-http schemes are refused even if host is local", () => {
  assert.throws(
    () => assertNetworkAllowed({ url: "file:///etc/passwd" }),
    (err: unknown) =>
      err instanceof NetworkGateError && /only http\/https/.test(err.message),
  );
  assert.throws(
    () => assertNetworkAllowed({ url: "gopher://localhost/" }),
    NetworkGateError,
  );
});

test("wouldBeAllowed reflects gate state without throwing", () => {
  const snap = snapshotEnv();
  try {
    clearGateEnv();
    assert.equal(wouldBeAllowed("http://localhost:8080"), true);
    assert.equal(wouldBeAllowed("https://google.com"), false);
  } finally {
    restoreEnv(snap);
  }
});

test("client.sendChat refuses public targets without ever calling axios", async () => {
  // Lazy import so we capture the env state set inside the test body.
  const { sendChat, sendRequest } = await import("./client");
  const snap = snapshotEnv();
  try {
    clearGateEnv();
    await assert.rejects(
      sendChat(
        {
          name: "evil",
          baseUrl: "https://api.openai.com",
          payloadFormat: "messages",
          chatPath: "/v1/chat/completions",
          pathMode: "explicit_plus_defaults",
        } as never,
        "hello",
      ),
      (err: unknown) =>
        err instanceof NetworkGateError &&
        /Refusing to send a public-target request/.test(err.message),
    );

    await assert.rejects(
      sendRequest("https://example.com", "/", "GET"),
      (err: unknown) =>
        err instanceof NetworkGateError &&
        /Refusing to send a public-target request/.test(err.message),
    );
  } finally {
    restoreEnv(snap);
  }
});

test("KOKULI_NETWORK_BYPASS only honored under NODE_ENV=test", () => {
  const snap = snapshotEnv();
  const origNodeEnv = process.env.NODE_ENV;
  try {
    clearGateEnv();
    process.env.NODE_ENV = "production";
    process.env.KOKULI_NETWORK_BYPASS = "1";
    assert.throws(
      () => assertNetworkAllowed({ url: "https://api.openai.com/" }),
      NetworkGateError,
    );

    process.env.NODE_ENV = "test";
    assertNetworkAllowed({ url: "https://api.openai.com/" });
  } finally {
    if (origNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = origNodeEnv;
    restoreEnv(snap);
  }
});
