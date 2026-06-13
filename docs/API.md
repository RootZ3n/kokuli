# API Reference — engine/ledger.ts

Append-only record of all Kokuli Bridge requests and their outcomes.

## Retention Policy

- `LEDGER_MAX_ENTRIES` (default 10 000): cap the ledger; oldest entries pruned first.
- `LEDGER_RETENTION_DAYS` (default 90): entries older than this are deleted on next write.

Override with env vars `LEDGER_MAX_ENTRIES` and `LEDGER_RETENTION_DAYS`.

---

## Constants

### `LEDGER_SCHEMA_VERSION`

- **Value:** `2`
- **Description:** Schema version bumped from 1 (implicit) when honesty-flagged entries were introduced. Entries without `schemaVersion` are pre-honesty-flag and treated as HISTORICAL.

---

## Types

### `LedgerEntry`

```typescript
type LedgerEntry = {
  id: string;                    // unique entry ID (timestamp + test ID)
  timestamp: string;             // ISO timestamp
  testId: string;                // test that triggered this
  target: string;                // target key
  endpoint: string;              // endpoint hit
  method: string;                // HTTP method
  model?: string;                // AI model used
  provider?: string;             // provider that handled it
  tokensIn?: number;             // input tokens
  tokensOut?: number;            // output tokens
  estimatedCostUsd?: number;     // estimated cost
  durationMs: number;            // total request time
  serverDurationMs?: number;     // server-side processing time
  tier?: string;                 // task type/tier
  receiptId?: string;            // routing decision ID
  modelRole?: string;            // model role designation
  escalated?: boolean;           // was request escalated
  httpStatus: number;
  result: "PASS" | "FAIL" | "WARN" | "PENDING";
  gatewayBlocked: boolean;
  schemaVersion?: number;        // Schema marker; entries without this are HISTORICAL
  unknownProvider?: boolean;     // true when receipt did not report a provider
  unknownModel?: boolean;        // true when receipt did not report a model
  unknownCost?: boolean;         // true when receipt did not include cost telemetry
  honestyFlags?: string[];       // optional honesty chip list
};
```

### `LedgerSummary`

```typescript
type LedgerSummary = {
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalEstimatedCostUsd: number;
  totalDurationMs: number;
  modelBreakdown: Record<string, { count: number; tokensIn: number; tokensOut: number; costUsd: number }>;
  providerBreakdown: Record<string, { count: number; tokensIn: number; tokensOut: number; costUsd: number }>;
  resultBreakdown: { pass: number; fail: number; warn: number };
  targetBreakdown: Record<string, number>;
  historicalCount: number;
  currentSchemaCount: number;
  unknownProviderCurrent: number;
  unknownProviderHistorical: number;
  unknownModelCurrent: number;
  unknownModelHistorical: number;
};
```

### `LedgerFilter`

```typescript
type LedgerFilter = {
  result?: "PASS" | "FAIL" | "WARN";
  target?: string;
  dateRange?: {
    from?: string; // ISO date string
    to?: string;   // ISO date string
  };
};
```

### `LedgerStats`

```typescript
type LedgerStats = {
  total: number;
  pass: number;
  fail: number;
  warn: number;
  totalCostUsd: number;
  avgDurationMs: number;
};
```

---

## Functions

### `loadLedger()`

- **Parameters:** None
- **Return type:** `Promise<LedgerEntry[]>`
- **Description:** Hydrate `sessionEntries` from disk, enforce retention caps, and (if needed) convert a legacy JSON-array file to JSONL or rewrite a pruned file. Idempotent — only the first call reads disk.

---

### `recordEntry(entry: LedgerEntry)`

- **Parameters:**
  - `entry: LedgerEntry` — the entry to record
- **Return type:** `Promise<void>`
- **Description:** Append a new entry to the ledger with schema version stamping and computed honesty flags (unknown provider/model/cost). Bounds the in-memory session cache and appends to disk in O(1).

---

### `getLedger()`

- **Parameters:** None
- **Return type:** `Promise<LedgerEntry[]>`
- **Description:** Return a shallow copy of all session ledger entries, loading from disk if not yet hydrated.

---

### `getLedgerSummary()`

- **Parameters:** None
- **Return type:** `Promise<LedgerSummary>`
- **Description:** Compute and return a full summary of all session ledger entries, including totals, model/provider breakdowns, result counts, and honesty rollups.

---

### `filterLedger(filter: LedgerFilter)`

- **Parameters:**
  - `filter: LedgerFilter` — optional result, target, and/or date range to filter by
- **Return type:** `Promise<LedgerEntry[]>`
- **Description:** Return a shallow copy of ledger entries matching the supplied filter criteria. All filter fields are optional; omit a field to skip it.

---

### `getEntriesByResult(result: "PASS" | "FAIL" | "WARN")`

- **Parameters:**
  - `result: "PASS" | "FAIL" | "WARN"` — the result status to match
- **Return type:** `Promise<LedgerEntry[]>`
- **Description:** Return all session entries whose `result` field matches the given value.

---

### `clearLedger()`

- **Parameters:** None
- **Return type:** `Promise<void>`
- **Description:** Clear all in-memory session entries and truncate the on-disk ledger file.

---

### `getSessionLedger()`

- **Parameters:** None
- **Return type:** `LedgerEntry[]`
- **Description:** Return a shallow copy of the current in-memory session entries without triggering a disk read.

---

### `__resetLedgerForTests()`

- **Parameters:** None
- **Return type:** `void`
- **Description:** **(Test-only)** Reset the lazy-load state and clear session entries so the next `loadLedger()` call re-reads disk. Used between test runs.

---

### `isHistoricalLedgerEntry(entry: LedgerEntry)`

- **Parameters:**
  - `entry: LedgerEntry` — the entry to check
- **Return type:** `boolean`
- **Description:** Return `true` if the entry was written by the pre-honesty-flag pipeline (no `schemaVersion`). Historical entries remain visible in transparency reports but are bucketed separately.

---

### `getLedgerStats(entries: LedgerEntry[])`

- **Parameters:**
  - `entries: LedgerEntry[]` — an array of ledger entries
- **Return type:** `LedgerStats`
- **Description:** Compute lightweight statistics (total/pass/fail/warn counts, total cost in USD, and average duration in ms) over the given entries. Returns 0 for `avgDurationMs` when the array is empty.

---

### `computeSummary(entries: LedgerEntry[])`

- **Parameters:**
  - `entries: LedgerEntry[]` — an array of ledger entries
- **Return type:** `LedgerSummary`
- **Description:** Compute and return a full summary over the given entries, including totals, model/provider breakdowns (with historical/current unknown splitting), result counts, and target breakdown.
