# Continue Without Claude — Verum

## What this repo does

Verum is the security/red-team evaluation suite. Engine in `engine/`,
HTTP server in `server/`, learning examples in `learning/`, install
scripts in `install/`. **Public RC was prepared 3 weeks ago but not
landed** — see uncommitted work on `main`.

## Common commands

```bash
npm run typecheck        # tsc -p tsconfig.json --noEmit
npm run build            # tsc + copy server/public into dist
npm test                 # node --test across engine/server/tools
npm run smoke            # build + engine/cli.js list
npm run diagnostic       # scripts/verum-diagnostic.mjs
npm run verify:release   # typecheck + build + test + smoke + diagnostic
npm run web              # build + run dist/server/index.js
npm run install:local    # install/install.sh
```

## Where to start

- `engine/cli.ts` — CLI entry, suite + target + report commands
- `engine/assessment.ts` — assessment runner
- `engine/evaluator.ts` — verdict logic
- `engine/bridge/verumBridge.ts` — cross-lab bridge
- `server/api.ts` — HTTP API
- `learning/` — example targets / suites for documentation
- `CHANGELOG.md` — release history
- `CLAUDE.md` — agent-specific notes

## Safe edit zones

- `docs/`, `learning/` (examples only)
- `tests/architecture/`, `tests/auth/` (JSON fixtures)
- `tools/verum-trace.*` (instrumentation helper)

## Dangerous edit zones

- `engine/evaluator.ts` — verdict logic (changes affect every past report)
- `engine/networkGate.ts` — network-egress policy
- `server/ops/redaction.ts` — Armory report redactor
- `engine/cli.ts` — public CLI surface
- `install/install.sh`, `install/install.ps1` — first-run flow

## How to recover

```bash
git log --oneline -10
# 89 dirty files on the public-RC prep branch — review with:
git status
git diff <file>

# To revert all uncommitted work:
git stash       # safer than 'git checkout .'
# To land it:
git add -A && git commit -m "verum: land public RC prep"
```

## Prompts for smaller models

```
"Add a new test fixture under tests/architecture/<name>.json matching
the schema of existing fixtures. Then run npm test."

"Update CHANGELOG.md with a new entry following the existing format."
```

## Top tasks (priority for next Claude session, if any)

1. **Decide what to do with the 89 dirty files** — land or stash
2. Investigate the 2 deleted server/access.{ts,test.ts} — intentional?
3. Run `npm run verify:release` once dirty state is resolved
4. Confirm the public-RC docs (README, SECURITY, WINDOWS-FIRST-RUN) reflect current behavior
5. Wire into symposium-command's `lab-wide-check.sh`
