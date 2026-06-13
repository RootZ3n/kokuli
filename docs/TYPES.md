# Types — engine/ledger.ts

All TypeScript interfaces and types exported from `engine/ledger.ts`.

---

## `LEDGER_SCHEMA_VERSION`

```typescript
export const LEDGER_SCHEMA_VERSION = 2;
```

The current schema version for ledger entries. Bumped from the implicit version 1
when honesty-flagged entries were introduced. Entries without `schemaVersion`
are treated as HISTORICAL (pre-honesty-flag pipeline).

---

## `LedgerEntry`

```typescript
export type LedgerEntry = { ... }
```

A single record in the append-only ledger, representing one Kokuli Bridge request
and its outcome.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique entry ID (timestamp + test ID). |
| `timestamp` | `string` | ISO timestamp of the request. |
| `testId` | `string` | Test that triggered this request. |
| `target` | `string` | Target key (maps to a target config). |
| `endpoint` | `string` | Endpoint hit. |
| `method` | `string` | HTTP method (e.g. `"POST"`). |
| `model` | `string` (optional) | AI model that handled the request. |
| `provider` | `string` (optional) | Provider that handled the request. |
| `tokensIn` | `number` (optional) | Input token count. |
| `tokensOut` | `number` (optional) | Output token count. |
| `estimatedCostUsd` | `number` (optional) | Estimated cost in USD. |
| `durationMs` | `number` | Total request time in milliseconds. |
| `serverDurationMs` | `number` (optional) | Server-side processing time in milliseconds. |
| `tier` | `string` (optional) | Task type / routing tier. |
| `receiptId` | `string` (optional) | Routing decision ID from Peh receipt. |
| `modelRole` | `string` (optional) | Model role designation. |
| `escalated` | `boolean` (optional) | Whether the request was escalated. |
| `httpStatus` | `number` | HTTP status code returned. |
| `result` | `"PASS" \| "FAIL" \| "WARN" \| "PENDING"` | Outcome of the request. |
| `gatewayBlocked` | `boolean` | Whether the gateway blocked the request. |
| `schemaVersion` | `number` (optional) | Schema marker. Entries without this are HISTORICAL — pre-honesty-flag pipeline. |
| `unknownProvider` | `boolean` (optional) | Computed at write time: `true` when receipt did not report a provider. |
| `unknownModel` | `boolean` (optional) | Computed at write time: `true` when receipt did not report a model. |
| `unknownCost` | `boolean` (optional) | Computed at write time: `true` when receipt did not include cost telemetry. |
| `honestyFlags` | `string[]` (optional) | Honesty chip list (lifted from the corresponding `TestResult`). |

---

## `LedgerSummary`

```typescript
export type LedgerSummary = { ... }
```

Aggregated summary computed from all entries in the ledger.

| Field | Type | Description |
|---|---|---|
| `totalRequests` | `number` | Total number of ledger entries. |
| `totalTokensIn` | `number` | Sum of input tokens across all entries. |
| `totalTokensOut` | `number` | Sum of output tokens across all entries. |
| `totalEstimatedCostUsd` | `number` | Sum of estimated costs in USD. |
| `totalDurationMs` | `number` | Sum of request durations in milliseconds. |
| `modelBreakdown` | `Record<string, { count: number; tokensIn: number; tokensOut: number; costUsd: number }>` | Per-model aggregation with count, tokens, and cost. Unknown models are bucketed as `"unknown (current)"` or `"unknown (historical)"`. |
| `providerBreakdown` | `Record<string, { count: number; tokensIn: number; tokensOut: number; costUsd: number }>` | Per-provider aggregation with count, tokens, and cost. Unknown providers are bucketed as `"unknown (current)"` or `"unknown (historical)"`. |
| `resultBreakdown` | `{ pass: number; fail: number; warn: number }` | Count of entries by result type. |
| `targetBreakdown` | `Record<string, number>` | Per-target entry count. |
| `historicalCount` | `number` | Entries without `schemaVersion` (pre-honesty-flag pipeline). |
| `currentSchemaCount` | `number` | Entries written by the post-audit pipeline. |
| `unknownProviderCurrent` | `number` | CURRENT entries that lacked a provider — operator-visible problem. |
| `unknownProviderHistorical` | `number` | HISTORICAL entries that lacked a provider — informational. |
| `unknownModelCurrent` | `number` | CURRENT entries that lacked a model — operator-visible problem. |
| `unknownModelHistorical` | `number` | HISTORICAL entries that lacked a model — informational. |

---

## `LedgerFilter`

```typescript
export type LedgerFilter = { ... }
```

Filter parameters for querying the ledger. All fields are optional — omit a field
to skip that filter criterion.

| Field | Type | Description |
|---|---|---|
| `result` | `"PASS" \| "FAIL" \| "WARN"` (optional) | Filter by request result. |
| `target` | `string` (optional) | Filter by target key. |
| `dateRange` | `{ from?: string; to?: string }` (optional) | ISO date range filter. `from` is inclusive, `to` is inclusive. |

---

## `LedgerStats`

```typescript
export type LedgerStats = { ... }
```

Lightweight statistics computed over an array of ledger entries.

| Field | Type | Description |
|---|---|---|
| `total` | `number` | Total number of entries. |
| `pass` | `number` | Count of entries with result `"PASS"`. |
| `fail` | `number` | Count of entries with result `"FAIL"`. |
| `warn` | `number` | Count of entries with result `"WARN"`. |
| `totalCostUsd` | `number` | Sum of `estimatedCostUsd` across all entries. |
| `avgDurationMs` | `number` | Average request duration in milliseconds. Returns `0` when the entry array is empty. |
