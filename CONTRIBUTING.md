# Contributing

## How to Build

```bash
npm ci
npm run build
```

Or with pnpm:

```bash
pnpm install
pnpm build
```

Run the type checker separately:

```bash
npm run typecheck
```

A full release verification (typecheck + build + test + smoke + diagnostic) is available:

```bash
npm run verify:release
```

## How to Test

Run the full test suite:

```bash
npm test
```

Run a smoke check to confirm the CLI boots correctly:

```bash
npm run smoke
```

Add new tests under `engine/` or `server/`. The test runner uses Node's built-in test runner with `ts-node/register` for TypeScript support.

## How to Submit Changes

1. Fork the repository and create a feature branch from `main`.
2. Make your changes, keeping the codebase TypeScript and CLI-first.
3. Add or update tests as needed.
4. Run `npm run verify:release` locally to ensure all checks pass.
5. Update relevant docs under `docs/` for any meaningful change.
6. Open a pull request with a clear title and description of the change.

All contributions must maintain the project's safety-by-default posture. Live network operations must remain opt-in. See `SECURITY.md` for the project's security and trust posture.
