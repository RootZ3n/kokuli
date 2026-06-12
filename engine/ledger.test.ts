// engine/ledger.test.ts
//
// Regression tests for historical/current ledger segregation.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";
import os from "os";
import path from "path";
import {
  computeSummary,
  isHistoricalLedgerEntry,
  LEDGER_SCHEMA_VERSION,
  LedgerEntry,
  LedgerFilter,
  recordEntry,
  loadLedger,
  getLedger,
  filterLedger,
  clearLedger,
  __resetLedgerForTests,
} from "./ledger";

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "id1",
    timestamp: "2026-05-14T10:00:00.000Z",
    testId: "t1",
    target: "demo",
    endpoint: "/chat",
    method: "POST",
    durationMs: 100,
    httpStatus: 200,
    result: "PASS",
    gatewayBlocked: false,
    ...overrides,
  };
}

async function withTempCwd<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const originalCwd = process.cwd();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kokuli-ledger-"));
  await fs.ensureDir(path.join(dir, "reports"));
  process.chdir(dir);
  __resetLedgerForTests();
  try {
    return await fn(dir);
  } finally {
    process.chdir(originalCwd);
    __resetLedgerForTests();
  }
}

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

test("ledger entry without schemaVersion is HISTORICAL", () => {
  const e = entry();
  delete (e as Partial<LedgerEntry>).schemaVersion;
  assert.equal(isHistoricalLedgerEntry(e), true);
});

test("ledger entry with schemaVersion is current", () => {
  const e = entry({ schemaVersion: LEDGER_SCHEMA_VERSION });
  assert.equal(isHistoricalLedgerEntry(e), false);
});

test("computeSummary buckets historical unknowns separately from current unknowns", () => {
  const historical = entry({ id: "h1" });
  delete (historical as Partial<LedgerEntry>).schemaVersion;
  const current = entry({ id: "c1", schemaVersion: LEDGER_SCHEMA_VERSION });
  const summary = computeSummary([historical, current]);
  assert.equal(summary.historicalCount, 1);
  assert.equal(summary.currentSchemaCount, 1);
  assert.equal(summary.unknownProviderHistorical, 1);
  assert.equal(summary.unknownProviderCurrent, 1);
  // Provider rollup keeps them in distinct buckets
  assert.ok(summary.providerBreakdown["unknown (historical)"]);
  assert.ok(summary.providerBreakdown["unknown (current)"]);
});

test("historical unknown provider does not contaminate current provider summary", () => {
  // Two historical unknowns and one current known.
  const h1 = entry({ id: "h1" });
  delete (h1 as Partial<LedgerEntry>).schemaVersion;
  const h2 = entry({ id: "h2" });
  delete (h2 as Partial<LedgerEntry>).schemaVersion;
  const knownCurrent = entry({ id: "c1", schemaVersion: LEDGER_SCHEMA_VERSION, provider: "openai", model: "gpt-4o" });
  const summary = computeSummary([h1, h2, knownCurrent]);
  assert.equal(summary.unknownProviderCurrent, 0);
  assert.equal(summary.unknownProviderHistorical, 2);
  assert.equal(summary.providerBreakdown.openai.count, 1);
});

test("current entry without provider is flagged as unknownProviderCurrent (actionable)", () => {
  const e = entry({ schemaVersion: LEDGER_SCHEMA_VERSION /* no provider */ });
  const summary = computeSummary([e]);
  assert.equal(summary.unknownProviderCurrent, 1);
  assert.equal(summary.unknownProviderHistorical, 0);
});

// --- H1: JSONL append-only + caps ---

test("recordEntry appends JSONL and loadLedger reads it back", async () => {
  await withTempCwd(async (dir) => {
    for (let i = 0; i < 100; i++) {
      await recordEntry(entry({ id: `e${i}`, timestamp: nowIso() }));
    }
    // File is JSONL: one JSON object per line, not a single array.
    const raw = await fs.readFile(path.join(dir, "reports", "ledger.json"), "utf8");
    const lines = raw.trim().split("\n");
    assert.equal(lines.length, 100);
    assert.doesNotThrow(() => JSON.parse(lines[0]));
    assert.doesNotThrow(() => JSON.parse(lines[99]));

    // A fresh load parses all 100.
    __resetLedgerForTests();
    const loaded = await loadLedger();
    assert.equal(loaded.length, 100);
  });
});

test("LEDGER_MAX_ENTRIES cap is enforced on load (oldest pruned)", async () => {
  await withTempCwd(async (dir) => {
    process.env.LEDGER_MAX_ENTRIES = "10";
    try {
      for (let i = 0; i < 25; i++) {
        await recordEntry(entry({ id: `e${i}`, timestamp: nowIso() }));
      }
      __resetLedgerForTests();
      const loaded = await loadLedger();
      assert.equal(loaded.length, 10);
      // Kept the newest 10 (e15..e24); oldest pruned.
      assert.equal(loaded[0].id, "e15");
      assert.equal(loaded[9].id, "e24");
      // The on-disk file was rewritten to the capped set.
      const raw = await fs.readFile(path.join(dir, "reports", "ledger.json"), "utf8");
      assert.equal(raw.trim().split("\n").length, 10);
    } finally {
      delete process.env.LEDGER_MAX_ENTRIES;
    }
  });
});

test("LEDGER_RETENTION_DAYS drops entries past the age window on load", async () => {
  await withTempCwd(async () => {
    process.env.LEDGER_RETENTION_DAYS = "30";
    try {
      const old = entry({ id: "old", timestamp: nowIso(-60 * 24 * 60 * 60 * 1000) }); // 60d ago
      const recent = entry({ id: "recent", timestamp: nowIso(-1 * 24 * 60 * 60 * 1000) }); // 1d ago
      await recordEntry(old);
      await recordEntry(recent);
      __resetLedgerForTests();
      const loaded = await loadLedger();
      const ids = loaded.map((e) => e.id);
      assert.deepEqual(ids, ["recent"]);
    } finally {
      delete process.env.LEDGER_RETENTION_DAYS;
    }
  });
});

test("legacy JSON-array ledger is converted to JSONL on first load", async () => {
  await withTempCwd(async (dir) => {
    const file = path.join(dir, "reports", "ledger.json");
    const legacy = [entry({ id: "a", timestamp: nowIso() }), entry({ id: "b", timestamp: nowIso() })];
    await fs.writeJson(file, legacy, { spaces: 2 });

    __resetLedgerForTests();
    const loaded = await loadLedger();
    assert.equal(loaded.length, 2);

    // File no longer starts with '[' — it was converted to JSONL.
    const raw = (await fs.readFile(file, "utf8")).trim();
    assert.ok(!raw.startsWith("["));
    assert.equal(raw.split("\n").length, 2);
  });
});

// --- H2: sessionEntries cap ---

test("sessionEntries is capped at LEDGER_MAX_ENTRIES in memory", async () => {
  await withTempCwd(async () => {
    process.env.LEDGER_MAX_ENTRIES = "5";
    try {
      for (let i = 0; i < 12; i++) {
        await recordEntry(entry({ id: `e${i}`, timestamp: nowIso() }));
      }
      // getLedger reflects the in-memory (capped) session cache.
      const inMem = await getLedger();
      assert.equal(inMem.length, 5);
      assert.equal(inMem[0].id, "e7");
      assert.equal(inMem[4].id, "e11");
    } finally {
      delete process.env.LEDGER_MAX_ENTRIES;
    }
  });
});

test("clearLedger empties memory and disk", async () => {
  await withTempCwd(async (dir) => {
    await recordEntry(entry({ id: "x", timestamp: nowIso() }));
    await clearLedger();
    assert.equal((await getLedger()).length, 0);
    const raw = await fs.readFile(path.join(dir, "reports", "ledger.json"), "utf8");
    assert.equal(raw.trim(), "");
  });
});

// --- filterLedger ---

function makeFilterEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "f1",
    timestamp: "2026-06-01T12:00:00.000Z",
    testId: "filter-test",
    target: "demo",
    endpoint: "/chat",
    method: "POST",
    durationMs: 50,
    httpStatus: 200,
    result: "PASS",
    gatewayBlocked: false,
    schemaVersion: LEDGER_SCHEMA_VERSION,
    ...overrides,
  };
}

async function seedFilterFixtures(): Promise<void> {
  await recordEntry(makeFilterEntry({ id: "pass-demo", result: "PASS", target: "demo", timestamp: "2026-06-01T12:00:00.000Z" }));
  await recordEntry(makeFilterEntry({ id: "fail-demo", result: "FAIL", target: "demo", timestamp: "2026-06-02T12:00:00.000Z" }));
  await recordEntry(makeFilterEntry({ id: "warn-demo", result: "WARN", target: "demo", timestamp: "2026-06-03T12:00:00.000Z" }));
  await recordEntry(makeFilterEntry({ id: "pass-staging", result: "PASS", target: "staging", timestamp: "2026-06-04T12:00:00.000Z" }));
  await recordEntry(makeFilterEntry({ id: "fail-staging", result: "FAIL", target: "staging", timestamp: "2026-06-05T12:00:00.000Z" }));
}

test("filterLedger without options returns all entries", async () => {
  await withTempCwd(async () => {
    await seedFilterFixtures();
    const result = await filterLedger({});
    assert.equal(result.length, 5);
  });
});

test("filterLedger by result PASS", async () => {
  await withTempCwd(async () => {
    await seedFilterFixtures();
    const result = await filterLedger({ result: "PASS" });
    assert.equal(result.length, 2);
    assert.ok(result.every((e) => e.result === "PASS"));
  });
});

test("filterLedger by result FAIL", async () => {
  await withTempCwd(async () => {
    await seedFilterFixtures();
    const result = await filterLedger({ result: "FAIL" });
    assert.equal(result.length, 2);
    assert.ok(result.every((e) => e.result === "FAIL"));
  });
});

test("filterLedger by result WARN", async () => {
  await withTempCwd(async () => {
    await seedFilterFixtures();
    const result = await filterLedger({ result: "WARN" });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "warn-demo");
  });
});

test("filterLedger by target", async () => {
  await withTempCwd(async () => {
    await seedFilterFixtures();
    const result = await filterLedger({ target: "staging" });
    assert.equal(result.length, 2);
    assert.ok(result.every((e) => e.target === "staging"));
  });
});

test("filterLedger by target with no matches", async () => {
  await withTempCwd(async () => {
    await seedFilterFixtures();
    const result = await filterLedger({ target: "nonexistent" });
    assert.equal(result.length, 0);
  });
});

test("filterLedger by dateRange.from only", async () => {
  await withTempCwd(async () => {
    await seedFilterFixtures();
    // Entries after 2026-06-03T12:00:00Z
    const result = await filterLedger({ dateRange: { from: "2026-06-03T12:00:00.001Z" } });
    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((e) => e.id).sort(),
      ["fail-staging", "pass-staging"]
    );
  });
});

test("filterLedger by dateRange.to only", async () => {
  await withTempCwd(async () => {
    await seedFilterFixtures();
    // Entries before 2026-06-03T12:00:00Z
    const result = await filterLedger({ dateRange: { to: "2026-06-03T11:59:59.999Z" } });
    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((e) => e.id).sort(),
      ["fail-demo", "pass-demo"]
    );
  });
});

test("filterLedger by dateRange.from and to", async () => {
  await withTempCwd(async () => {
    await seedFilterFixtures();
    // Entries on 2026-06-02 (inclusive)
    const result = await filterLedger({ dateRange: { from: "2026-06-02T00:00:00.000Z", to: "2026-06-02T23:59:59.999Z" } });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "fail-demo");
  });
});

test("filterLedger combines result + target", async () => {
  await withTempCwd(async () => {
    await seedFilterFixtures();
    const result = await filterLedger({ result: "FAIL", target: "staging" });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "fail-staging");
  });
});

test("filterLedger combines result + dateRange", async () => {
  await withTempCwd(async () => {
    await seedFilterFixtures();
    // PASS entries after 2026-06-03
    const result = await filterLedger({ result: "PASS", dateRange: { from: "2026-06-03T12:00:00.001Z" } });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "pass-staging");
  });
});

test("filterLedger combines target + dateRange", async () => {
  await withTempCwd(async () => {
    await seedFilterFixtures();
    // demo-targeted entries before 2026-06-03
    const result = await filterLedger({ target: "demo", dateRange: { to: "2026-06-03T11:59:59.999Z" } });
    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((e) => e.id).sort(),
      ["fail-demo", "pass-demo"]
    );
  });
});

test("filterLedger combines result + target + dateRange", async () => {
  await withTempCwd(async () => {
    await seedFilterFixtures();
    // WARN, demo, on 2026-06-03
    const result = await filterLedger({
      result: "WARN",
      target: "demo",
      dateRange: { from: "2026-06-03T00:00:00.000Z", to: "2026-06-03T23:59:59.999Z" },
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "warn-demo");
  });
});

test("filterLedger returns empty array when no entries match", async () => {
  await withTempCwd(async () => {
    await seedFilterFixtures();
    const result = await filterLedger({ result: "FAIL", target: "demo", dateRange: { from: "2099-01-01T00:00:00.000Z" } });
    assert.equal(result.length, 0);
  });
});
