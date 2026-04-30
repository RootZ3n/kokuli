# Finding Metadata Schema

The `reports/finding-metadata.json` file holds two top-level maps: `overrides` and `workflow`.

## Shape

```typescript
interface FindingOverride {
  lifecycle: "muted" | "accepted_risk";
  reason: string;           // Why this override was applied
  updatedAt: string;         // ISO-8601 timestamp of last change
  owner?: string;           // Who applied the override
  expiry?: string;          // ISO-8601 expiry (muted findings re-alert after this)
  reviewNote?: string;      // Free-text review note
}

interface FindingWorkflowMetadata {
  // Per-finding workflow state — consumed by Verum Trace to show lifecycle
  lastSeenAt: string;       // ISO-8601
  status: "open" | "muted" | "accepted_risk" | "resolved";
  assignee?: string;
}

interface FindingMetadataFile {
  overrides: Record<string, FindingOverride>;       // key = finding id
  workflow: Record<string, FindingWorkflowMetadata>; // key = finding id
}
```

## Top-level Keys

| Key | Type | Description |
|-----|------|-------------|
| `overrides` | `Record<string, FindingOverride>` | Mute or risk-accept overrides for specific findings |
| `workflow` | `Record<string, FindingWorkflowMetadata>` | Workflow state (status, assignee, last-seen) per finding |

## Override Keys (`overrides`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `lifecycle` | `"muted"` \| `"accepted_risk"` | Yes | Override type |
| `reason` | `string` | Yes | Human-readable justification |
| `updatedAt` | `string` (ISO-8601) | Yes | Last modification timestamp |
| `owner` | `string` | No | Who applied the override |
| `expiry` | `string` (ISO-8601) | No | Muting expiry — finding re-alerts after this time |
| `reviewNote` | `string` | No | Free-text note for reviewers |

## Workflow Keys (`workflow`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `lastSeenAt` | `string` (ISO-8601) | Yes | When the finding was last observed |
| `status` | `"open"` \| `"muted"` \| `"accepted_risk"` \| `"resolved"` | Yes | Current lifecycle status |
| `assignee` | `string` | No | Who is working the finding |

## Finding ID Format

Finding IDs are constructed as `{category}-{number}-{slug}`, e.g. `exfil-013-benign-diagnostics-metadata-leak`.

## Loading

The `engine/findingMetadata.ts` module reads and writes this file via `loadFindingMetadata()` and `saveFindingMetadata()`. Do not edit the JSON by hand while Verum is running — edits may be overwritten on the next write.
