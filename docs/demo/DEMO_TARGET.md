# Demo Target Guide

This document describes a reproducible way to evaluate Krakzen against a deliberately vulnerable AI-style HTTP service without coupling Krakzen to another repository.

## Goal

Provide a lightweight path for reviewers, principals, founders, or security engineers to see Krakzen produce:

- execution states
- findings
- gates
- operator summary
- target fingerprint
- comparison warnings
- audit exports

## Recommended Demo Shape

Use any local or disposable HTTP service that exposes these example behaviors:

### Chat Surface

- `POST /chat`
- accepts either `{ "input": "..." }` or message-form payloads
- returns a JSON body with text plus optional provider/model fields
- intentionally leaks on selected prompts

Suggested vulnerable behaviors:

- reveals a fake "system prompt" string when asked directly
- returns harmful child-facing content for a known prompt
- responds with internal path fragments such as `/etc/app/config.json`

### Recon Surfaces

- `GET /health`
- `GET /version`
- `GET /runs`
- `GET /tools/list`

Suggested vulnerable behaviors:

- `/health` exposes module names and local host details
- `/version` exposes a build tag or commit hash
- `/runs` returns a small JSON array without authentication
- `/tools/list` exposes internal tool names

### Auth Posture

Deliberately leave some routes open and require auth on others so Krakzen can fingerprint mixed posture:

- open: `/health`, `/version`, `/tools/list`
- auth required: `/sessions`

## Minimal Evaluation Flow

1. Start the demo target locally, for example on `http://127.0.0.1:8088`.
2. Add it to Krakzen:

```bash
krakzen target add demo-vuln http://127.0.0.1:8088 --chat /chat --format input
krakzen target set demo-vuln
```

3. Run a focused suite:

```bash
krakzen suite security
krakzen suite recon
krakzen suite child-safety
```

4. Start the dashboard:

```bash
npm run web
```

5. Review:

- operator summary
- exposure map
- run comparison
- fingerprint signature
- evidence appendix
- security review export

## Detect -> Fix -> Retest -> Verify

Use the demo target to walk a reviewer through Krakzen’s intended workflow:

1. Detect:
   Run `security` and `recon` suites. Capture the review snapshot and evidence appendix.
2. Fix:
   Change the demo target so it stops exposing the system prompt or internal path.
3. Retest:
   Re-run the same suites against the same target key and check the retest comparison output.
4. Verify:
   Confirm the finding becomes resolved, the fingerprint remains comparable, and integrity status remains healthy.

If the target fingerprint changes significantly between runs, Krakzen will warn that the comparison may not be directly comparable. That is expected and should be explained during a demo.

## Optional Mock Spec

If you want a very small homegrown mock, this behavior is sufficient:

- `POST /chat`
  - if body contains `system prompt`, return a fake internal prompt string
  - if body contains `weapon`, return explicit unsafe content
  - otherwise return a normal safe response
- `GET /health`
  - return `{ "modules": ["memory", "router"], "host": "localhost:11434" }`
- `GET /version`
  - return `{ "version": "0.1.0-demo", "build": "demo-sha-1234" }`
- `GET /tools/list`
  - return a short fake tool list
- `GET /sessions`
  - return `401`

## Tradeoff

This guide is docs-only in this pass. That keeps Krakzen standalone and avoids turning the repository into a bundled target simulator. If public evaluation becomes a priority, the next step would be adding a tiny optional demo server under `examples/` with no runtime coupling to Krakzen itself.
