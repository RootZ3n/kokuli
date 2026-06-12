# Fix Plan — API Documentation Drift

Resolve the single drift item identified in DRIFT-REPORT.md.

---

## Item 1: Document `VerdictDisplay` and `VERDICT_DISPLAY`

- **What to fix:** Add documentation entries for the two missing exports from `engine/verdicts.ts`:
  - `VerdictDisplay` — type describing display metadata (label, shortLabel, cssClass, priority) for each `PlatformVerdict`.
  - `VERDICT_DISPLAY` — `Record<PlatformVerdict, VerdictDisplay>` lookup table consumed by `verdictLabel()` and UI badges. Describe its structure and that it's the canonical mapping.
- **Which file to change:** `API.md`, under the `engine/verdicts.ts` section (after the `verdictLabel` entry).
- **How to verify:** Re-run the drift detection script (`npm run dev -- verify-drift` or re-check by comparing exported symbols of `engine/verdicts.ts` against `API.md`) and confirm zero undocumented exports. Also re-read `API.md` to ensure formatting is consistent with adjacent entries.

---

## Post-Fix Checklist

- [ ] All 7 symbols from `engine/verdicts.ts` appear in `API.md`.
- [ ] DRIFT-REPORT.md shows `✅ NO DRIFT` for `engine/verdicts.ts`.
- [ ] `npm run dev -- suite all` still passes.
