import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";
import os from "os";
import path from "path";
import {
  createTarget,
  deleteTarget,
  formatTargetValidationError,
  loadTargets,
  normalizeEndpointPath,
  normalizeTargetsFile,
  resolvePathForAlias,
  resolveRequestPath,
  resolveTemporaryTarget,
  resolveTargetEndpoints,
  setActiveTarget,
  updateTarget,
} from "./targets";

const originalTargetsPath = process.env.KRAKZEN_TARGETS_PATH;

async function withTargetsFile<T>(data: unknown, fn: () => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "krakzen-targets-"));
  const filePath = path.join(dir, "targets.json");
  process.env.KRAKZEN_TARGETS_PATH = filePath;
  await fs.writeJson(filePath, data, { spaces: 2 });
  try {
    return await fn();
  } finally {
    if (originalTargetsPath) process.env.KRAKZEN_TARGETS_PATH = originalTargetsPath;
    else delete process.env.KRAKZEN_TARGETS_PATH;
    await fs.remove(dir);
  }
}

test("target configuration normalization and CRUD remain deterministic", async () => {
  assert.equal(normalizeEndpointPath("health"), "/health");
  assert.equal(normalizeEndpointPath("/runs/"), "/runs");
  assert.equal(normalizeEndpointPath(" "), undefined);

  const normalized = normalizeTargetsFile({
    defaultTarget: "legacy",
    targets: {
      legacy: {
        name: "Legacy",
        baseUrl: "http://example.test/",
        chatPath: "/api/chat/",
        payloadFormat: "messages",
      },
    },
  });
  assert.equal(normalized.targets.legacy.baseUrl, "http://example.test");
  assert.equal(normalized.targets.legacy.endpoints?.chat, "/api/chat");
  assert.equal(normalized.targets.legacy.pathMode, "explicit_plus_defaults");

  const explicitOnly = resolveTargetEndpoints({
    name: "Explicit",
    baseUrl: "http://example.test",
    payloadFormat: "messages",
    pathMode: "explicit_only",
    endpoints: {
      chat: "/v1/chat",
      health: "/ready",
    },
  });
  assert.deepEqual(explicitOnly, { chat: "/v1/chat", health: "/ready" });

  const explicitPlusDefaults = resolveTargetEndpoints({
    name: "Defaults",
    baseUrl: "http://example.test",
    payloadFormat: "messages",
    pathMode: "explicit_plus_defaults",
    endpoints: {
      chat: "/v2/chat",
    },
  });
  assert.equal(explicitPlusDefaults.chat, "/v2/chat");
  assert.equal(explicitPlusDefaults.health, "/health");
  assert.equal(explicitPlusDefaults.tools, "/tools/list");

  const temporary = resolveTemporaryTarget({
    id: "quick-probe",
    name: "Quick Probe",
    baseUrl: "http://example.test",
    payloadFormat: "messages",
    endpoints: { chat: "/chat" },
    auth: { headerName: "authorization", token: "secret" },
  });
  assert.equal(temporary.source, "temporary");
  assert.equal(resolvePathForAlias(temporary, "chat"), "/chat");
  assert.equal(temporary.auth.token, "secret");

  const skippedHealth = resolveRequestPath(resolveTemporaryTarget({
    id: "explicit-only",
    name: "Explicit Only",
    baseUrl: "http://example.test",
    payloadFormat: "messages",
    pathMode: "explicit_only",
    endpoints: { chat: "/chat" },
  }), "/health");
  assert.equal(skippedHealth.skipped, true);
  assert.equal(skippedHealth.alias, "health");

  await withTargetsFile({
    defaultTarget: "seed",
    targets: {
      seed: {
        name: "Seed",
        baseUrl: "http://seed.test",
        payloadFormat: "messages",
        chatPath: "/chat",
      },
    },
  }, async () => {
    await createTarget({
      id: "custom",
      name: "Custom",
      baseUrl: "http://custom.test",
      payloadFormat: "input",
      pathMode: "explicit_only",
      endpoints: { chat: "/v1/chat" },
      auth: { headerName: "x-api-key", token: "abc123" },
      notes: "saved from ui",
    });

    let loaded = await loadTargets();
    assert.ok(loaded.targets.custom);
    assert.equal(loaded.targets.custom.endpoints?.chat, "/v1/chat");

    await updateTarget("custom", { endpoints: { health: "/ready" } });
    loaded = await loadTargets();
    assert.equal(loaded.targets.custom.endpoints?.health, "/ready");

    await setActiveTarget("custom");
    loaded = await loadTargets();
    assert.equal(loaded.defaultTarget, "custom");

    await deleteTarget("seed");
    loaded = await loadTargets();
    assert.ok(!loaded.targets.seed);
  });

  await withTargetsFile({
    defaultTarget: "seed",
    targets: {
      seed: {
        name: "Seed",
        baseUrl: "http://seed.test",
        payloadFormat: "messages",
        chatPath: "/chat",
      },
    },
  }, async () => {
    await createTarget({
      id: "no-auth",
      name: "No Auth",
      baseUrl: "http://no-auth.test",
      payloadFormat: "messages",
      endpoints: { chat: "/chat" },
    });
    const loaded = await loadTargets();
    assert.equal(loaded.targets["no-auth"].baseUrl, "http://no-auth.test");
    assert.equal(loaded.targets["no-auth"].auth?.token, undefined);
  });

  await withTargetsFile({
    defaultTarget: "seed",
    targets: {
      seed: {
        name: "Seed",
        baseUrl: "http://seed.test",
        payloadFormat: "messages",
        chatPath: "/chat",
      },
      secure: {
        name: "Secure",
        baseUrl: "http://secure.test",
        payloadFormat: "messages",
        endpoints: { chat: "/chat" },
        auth: { headerName: "authorization", token: "keep-me" },
      },
    },
  }, async () => {
    await updateTarget("secure", {
      name: "Secure Updated",
      auth: { headerName: "authorization", token: "" },
    });
    const loaded = await loadTargets();
    assert.equal(loaded.targets.secure.name, "Secure Updated");
    assert.equal(loaded.targets.secure.auth?.token, "keep-me");
  });

  await withTargetsFile({ defaultTarget: "", targets: {} }, async () => {
    await assert.rejects(
      () => createTarget({
        id: "broken",
        name: "Broken",
        baseUrl: "not-a-url",
        payloadFormat: "messages",
      }),
      (error) => /base URL/.test(formatTargetValidationError(error)),
    );
  });
});
