// engine/ledger.test.ts
//
// Regression tests for historical/current ledger segregation.

import test from "node:test";
import assert from "node:assert/strict";
import { computeSummary, isHistoricalLedgerEntry, LEDGER_SCHEMA_VERSION, LedgerEntry } from "./ledger";

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
