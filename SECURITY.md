# Security Policy

## Scope

Kokuli is a defensive AI fracture-testing tool for systems you own or are explicitly authorized to test. Do not use Kokuli against public internet systems, third-party services, or production systems without clear written authorization.

## Safe Defaults

- Web server default bind: `127.0.0.1`. Set `KOKULI_HOST` (comma-separated list; `VERUM_HOST` accepted as fallback) to additionally bind a Tailscale or other trusted interface.
- Live Armory / Break Me network operations require `KOKULI_ENABLE_NETWORK_OPS=1` (`VERUM_ENABLE_NETWORK_OPS` accepted as fallback).
- Live checks require explicit ownership confirmation.
- Public IP and public domain live checks are blocked in the public RC line.
- Armory receipts redact and summarize evidence before report write.

## Deployment posture: lab-only

Kokuli is a lab-only tool. The web server has no authentication gates and no per-route localhost restrictions: anything that can reach the bind address can use the API. Limit network exposure at the bind layer (default `127.0.0.1`, optionally a Tailscale IP) and your operating system firewall — do not place Kokuli on an untrusted network.

## Reporting A Vulnerability

For the public RC, report security issues through a private maintainer channel or a private GitHub security advisory if available. Do not publish exploit details or sensitive report artifacts publicly.

Please include:

- Affected version or commit.
- Reproduction steps using only owned/local targets.
- Expected behavior.
- Actual behavior.
- Whether any report artifact contained sensitive data.

## Report Handling

Kokuli reports can contain sensitive engineering evidence even after redaction. Treat `reports/` output as confidential unless it has been reviewed and intentionally sanitized for sharing.

## Dependency Audit Status

As of the RC hardening pass on 2026-04-30:

- `npm audit fix` updated vulnerable transitive packages for axios/follow-redirects, brace-expansion, and path-to-regexp.
- `npm audit --audit-level=moderate` reports zero known vulnerabilities.

Keep running:

```bash
npm audit --audit-level=moderate
```

before release tagging.

---

## Audit Summary — 2026-05-04

> **Note (2026-05-10):** The `VERUM_API_TOKEN` gate and the per-route loopback checks described below were removed as part of moving Kokuli (then Verum) to a lab-only deployment posture. The audit record is retained for history. Current access control is bind-layer only (see *Safe Defaults* above).


### Scope
Full security audit of Kokuli v0.2.0 (then named Verum) focusing on authentication, authorization, injection hardening, and SSRF protection. The following findings were identified and resolved.

### Issues Fixed

#### 1. 🔴 Critical — Report endpoints were open without authentication (CVE-class)
**Files:** `server/api.ts`, `server/access.ts`
**Severity:** Critical
**Finding:** `/api/reports/summary`, `/api/dashboard`, and `/api/reports/latest` used only `requireLocalAccess()` (loopback check). Since Kokuli binds to `127.0.0.1` by default, any local user or local process could read full assessment reports and test results without any token. This exposed all test results, target configs, and findings to any local actor.

**Fix:** Added a new `requireAuth()` middleware (token-only, no localhost restriction) and applied it to all report endpoints. The `requireLocalAccess` ops routes (ops/run, ops/kill, ops/reset) continue to require both localhost origin AND valid token.

Additionally changed `apiTokenMatches()` to fail-closed when VERUM_API_TOKEN is unset (previously it returned `true` with no token set, which could mislead operators).

#### 2. 🔴 Critical — Timing attack on token comparison
**File:** `server/access.ts`
**Severity:** High
**Finding:** Token comparison used `===` which is not constant-time. A skilled attacker who can measure response time differences could potentially guess the token character-by-character.

**Fix:** Added `timingSafeEqual()` using char-by-char XOR accumulation — constant time regardless of where the mismatch occurs.

#### 3. 🟡 Medium — No authentication status indicator
**File:** `server/access.ts`
**Finding:** No `isAuthEnabled()` function existed to let operators or tooling query whether VERUM_API_TOKEN is configured.

**Fix:** Added `export function isAuthEnabled(): boolean` — returns true only when VERUM_API_TOKEN is set in the environment.

### Auth Architecture (Post-Fix)

| Route | Auth Required |
|---|---|
| `GET /api/meta` | None (public, server info only) |
| `GET /health` | None (public health check) |
| `GET /api/tests` | None (localhost only by bind) |
| `GET /api/targets`, `POST /api/targets` | None (localhost only by bind) |
| `POST /api/targets/resolve`, `/api/targets/probe` | None (localhost only by bind; internal network gate blocks non-private targets) |
| `GET /api/reports/summary` | **VERUM_API_TOKEN** (token auth from any IP) |
| `GET /api/dashboard` | **VERUM_API_TOKEN** (token auth from any IP) |
| `GET /api/reports/latest` | **VERUM_API_TOKEN** (token auth from any IP) |
| `GET/DELETE /api/transparency` | None (session ledger, operator use only) |
| `POST /api/ops/run` | **localhost + VERUM_API_TOKEN** |
| `POST /api/ops/kill` | **localhost + VERUM_API_TOKEN** |
| `POST /api/ops/reset` | **localhost + VERUM_API_TOKEN** |
| `POST /api/bridge/verum/run` | None (allowlist enforcement, narrow bridge contract) |
| `GET /api/bridge/runs` | None (read-only, no secrets) |
| `GET /api/bridge/runs/:runId` | None (read-only, no secrets) |

### Other Security Controls Verified

- **Rate limiting:** 120 req/min (read), 60 req/min (write) per IP — works at the API level before routing.
- **CSP headers:** `default-src 'self'; script-src 'self' 'unsafe-inline'` etc. — blocks XSS from external sources.
- **SSRF protection:** `NetworkGate` in `engine/networkGate.ts` enforces `VERUM_ENABLE_NETWORK_OPS=1` + `VERUM_OWNERSHIP_CONFIRMED=1` for non-private outbound targets. Armory `safety.ts` further restricts to localhost/private IPs only unless `advancedMode=true`.
- **Command injection:** Armory's `toolRunner.ts` uses `spawn` with `shell: false` and an allowlist of nmap flags. Bridge uses `spawn(shell=false)` with no shell interpolation. All user input is validated against allowlists in `verumBridge.ts`.
- **Redaction:** `server/ops/redaction.ts` scrubs Authorization headers, Bearer tokens, API keys, cookies, private keys, file paths, and large base64 tokens from all evidence before report write.
- **Path traversal:** Reports and bridge run data use `process.cwd()` roots. No arbitrary filesystem access.
- **Express body limit:** `express.json({ limit: "1mb" })` prevents large payload DoS.
- **Static file serving:** Only `server/public/` is served. `reports/` is protected by `requireLocalAccess` on a separate mount point.
- **Token generation:** When VERUM_API_TOKEN is unset, the server no longer silently operates in "open mode" for authenticated routes. The operator must explicitly set a token.

### Recommended Operator Configuration

```bash
# For live Armory ops (network probing of your own lab):
KOKULI_ENABLE_NETWORK_OPS=1
KOKULI_OWNERSHIP_CONFIRMED=1

# Start Kokuli
systemctl --user start kokuli-web
```

### Test Results
All 149 logic tests pass, including:
- `access.test.ts` — loopback detection, fail-closed token, constant-time comparison
- `armory.test.ts` — guardrails, kill switch, SSRF blocks, dry-run simulation
- `api.test.ts` — token gate enforcement, ops route protection
- `redaction.test.ts` — Authorization/Bearer/cookie redaction
- `verumBridge.test.ts` — allowlist enforcement, shell metachar rejection, argv isolation
