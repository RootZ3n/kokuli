# FIX-PLAN: Test Coverage Improvements for `engine/ledger.ts`

Analysis of the existing test file (`engine/ledger.test.ts`, 454 lines) against the source
(`engine/ledger.ts`, 397 lines) reveals three meaningful coverage gaps.

---

## Gap 1: Honesty-Flag Enrichment in `recordEntry` is Untested

**What's missing:**  
The `recordEntry` function enriches every incoming entry with computed honesty metadata
(`schemaVersion`, `unknownProvider`, `unknownModel`, `unknownCost`, and the `honestyFlags`
array). No existing test verifies that these fields are stamped correctly under any
combination of missing/present provider, model, or cost.

**Why it matters:**  
Downstream consumers — transparency reports, the summary endpoint, and operator dashboards
— all depend on these flags to distinguish "we know the provider/model/cost" from "the
receipt was missing telemetry." If `recordEntry` miscomputes a flag (e.g., stamps
`unknownProvider: false` for an entry that has no `provider`), the reporting layer
produces misleading rollups. Since the honesty-flag pipeline was introduced in schema
version 2, this is now the core path through which every new entry flows — it should
have its own dedicated test suite.

**Suggested test:**  
Add a suite under `// --- recordEntry honesty-flag enrichment ---` that exercises:

1. **Entry with full telemetry** — `recordEntry` an entry that already has
   `provider: "openai"`, `model: "gpt-4o"`, `estimatedCostUsd: 0.01`. Assert the
   resulting entry in the session cache has `unknownProvider === false`,
   `unknownModel === false`, `unknownCost === false`, and no `honestyFlags` added
   beyond what was passed in.

2. **Entry missing provider** — `recordEntry` an entry with no `provider`. Assert
   `unknownProvider === true` and that `honestyFlags` contains `"UNKNOWN_PROVIDER"`.

3. **Entry missing model** — `recordEntry` an entry with no `model`. Assert
   `unknownModel === true` and `honestyFlags` contains `"UNKNOWN_MODEL"`.

4. **Entry missing cost** — `recordEntry` an entry without `estimatedCostUsd`.
   Assert `unknownCost === true` and `honestyFlags` contains `"UNKNOWN_COST"`.

5. **Entry with all three missing** — Assert all three unknown booleans are `true`
   and all three flag strings appear in `honestyFlags`.

6. **Pre-existing honesty flags are preserved** — `recordEntry` an entry that
   already carries `honestyFlags: ["SUSPICIOUS_TIMING"]`. Assert the final array
   includes both the pre-existing flag and the newly computed flags.

---

## Gap 2: `getSessionLedger()` is Never Tested

**What's missing:**  
The synchronous `getSessionLedger()` function returns a shallow copy of the in-memory
session entries. It is exported and used by CLI code (`engine/cli.ts`), but no test
calls it directly or validates its behavior.

**Why it matters:**  
`getSessionLedger()` provides a synchronous snapshot of the current session state. If
a bug in the module-level `sessionEntries` array or in `__resetLedgerForTests()`
corrupts state, `getSessionLedger()` would return incorrect data — and no test would
catch it. Additionally, synchronous access patterns are different from async
(`getLedger`), so any divergence could cause subtle bugs in the CLI path.

**Suggested test:**  
Add tests that:

1. **After `recordEntry`, `getSessionLedger()` returns the same entries as
   `getLedger()`** — Record a few entries via `recordEntry`, then compare
   `getSessionLedger()` (sync) with `await getLedger()` (async). Assert they
   are deep-equal and that the returned array is a distinct reference (not the
   internal array).

2. **Mutating the returned array does not affect the session** — Call
   `getSessionLedger()`, mutate the result (e.g., `pop()`), then call
   `getSessionLedger()` again. Assert the second result still contains all
   entries.

3. **After `clearLedger`, `getSessionLedger()` returns empty** — Record an entry,
   call `clearLedger()`, then assert `getSessionLedger()` returns `[]`.

4. **After `__resetLedgerForTests()`, `getSessionLedger()` returns empty** —
   Record an entry, reset, assert `getSessionLedger()` returns `[]`.

---

## Gap 3: PENDING Result Entries in `computeSummary` and `getLedgerStats`

**What's missing:**  
The `LedgerEntry` type includes `"PENDING"` in its `result` union
(`"PASS" | "FAIL" | "WARN" | "PENDING"`), but:

- `computeSummary` only counts pass/fail/warn in `resultBreakdown` — PENDING entries
  are silently invisible.
- `getLedgerStats` similarly only counts pass/fail/warn.
- No test exercises entries with `result: "PENDING"`.

**Why it matters:**  
If the system ever produces a PENDING entry (e.g., an in-flight request captured by
the ledger before completion, or a future asynchronous test mode), the summary
statistics would silently under-report the total. An operator looking at the
`resultBreakdown` might think 100% of entries are accounted for when they are not.
This is both a documentation question ("is PENDING deliberately excluded?") and a
correctness concern — the `totalRequests` field in `LedgerSummary` counts them, but
the breakdown does not, creating an internal inconsistency.

**Suggested test:**  
Add tests that:

1. **`computeSummary` with a PENDING entry** — Pass an array with one entry where
   `result: "PENDING"`. Assert `summary.totalRequests === 1` and that the
   `resultBreakdown` fields (pass/fail/warn) sum to 0. This documents the current
   behavior (silent exclusion) as a deliberate choice; a follow-up decision could
   add `resultBreakdown.pending`.

2. **`getLedgerStats` with a PENDING entry** — Pass an array with one PENDING entry.
   Assert `stats.total === 1` and `stats.pass + stats.fail + stats.warn === 0`.

3. **Mixed entries including PENDING** — Pass an array with 1 PASS, 1 FAIL, 1 WARN,
   and 1 PENDING. Assert `totalRequests === 4` but `resultBreakdown` only sums to 3.
   This explicitly surfaces the inconsistency.
