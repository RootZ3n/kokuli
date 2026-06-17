# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅ |

## Reporting a Vulnerability

Open a private security advisory on GitHub or contact the maintainer directly.

## Safe Defaults

- Bind to **`127.0.0.1`** only by default (loopback). Operator must explicitly set `KOKULI_HOST=0.0.0.0` for network exposure.
- **No authentication.** Access control is bind-layer-only. Anyone who can reach the port can use all endpoints.
- For external exposure (Tailscale, public), place behind a **reverse proxy** (nginx, Caddy, Traefik) with operator-supplied authentication and TLS.
- Rate limiting: **120 req/min** (read) and **60 req/min** (write) per IP.
- CSP and security headers applied to all responses.
- Same-origin policy enforced; CORS is disabled by default.
- Express body limit of **1 MB** prevents large payload DoS.
- Network operations require explicit opt-in via `KOKULI_ENABLE_NETWORK_OPS=1` and `KOKULI_OWNERSHIP_CONFIRMED=1`.
- NetworkGate SSRF protection blocks non-private outbound targets unless both flags are set.

## Security Controls

### Network Gate
`engine/networkGate.ts` enforces dual-flag SSRF protection: loopback/RFC1918/RFC6598/ULA/link-local/`.local` are allowed by default; everything else is refused unless `KOKULI_ENABLE_NETWORK_OPS=1` and `KOKULI_OWNERSHIP_CONFIRMED=1` are both set.

### Command Injection Prevention
- Armory's `toolRunner.ts` uses `spawn` with `shell: false` and an allowlist of nmap flags.
- Bridge uses `spawn(shell=false)` with no shell interpolation.
- All user input is validated against allowlists.

### Redaction
`server/ops/redaction.ts` scrubs Authorization headers, Bearer tokens, API keys, cookies, private keys, file paths, and large base64 tokens from all evidence before report write.

### Path Traversal
Reports and bridge run data use `process.cwd()` roots. No arbitrary filesystem access.

## Scope

The following are considered in-scope for security review:

- Authentication and authorization bypass
- SSRF via NetworkGate or target resolution
- Command injection via armory tool execution
- Secret leakage in reports, logs, or API responses
- Path traversal in file operations

### Test Results

The test suite includes coverage for:
- `armory.test.ts` — guardrails, kill switch, SSRF blocks, dry-run simulation
- `api.test.ts` — rate limiting, route protection
- `redaction.test.ts` — Authorization/Bearer/cookie redaction
- `verumBridge.test.ts` — allowlist enforcement, shell metachar rejection, argv isolation

## Dependencies

`npm audit --audit-level=moderate` reports no known vulnerabilities as of the last check.

## Disclosure Policy

We follow responsible disclosure. Please report vulnerabilities privately before public disclosure.
