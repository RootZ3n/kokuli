# Security Policy

## Scope

Verum is a defensive AI trust-testing tool for systems you own or are explicitly authorized to test. Do not use Verum against public internet systems, third-party services, or production systems without clear written authorization.

## Safe Defaults

- Web server default bind: `127.0.0.1`.
- Live Armory / Break Me network operations require `VERUM_ENABLE_NETWORK_OPS=1`.
- Live checks require explicit ownership confirmation.
- Public IP and public domain live checks are blocked in the public RC line.
- Protected ops/report routes enforce localhost access and respect `VERUM_API_TOKEN` when configured.
- Armory receipts redact and summarize evidence before report write.

## Reporting A Vulnerability

For the public RC, report security issues through a private maintainer channel or a private GitHub security advisory if available. Do not publish exploit details or sensitive report artifacts publicly.

Please include:

- Affected version or commit.
- Reproduction steps using only owned/local targets.
- Expected behavior.
- Actual behavior.
- Whether any report artifact contained sensitive data.

## Report Handling

Verum reports can contain sensitive engineering evidence even after redaction. Treat `reports/` output as confidential unless it has been reviewed and intentionally sanitized for sharing.

## Dependency Audit Status

As of the RC hardening pass on 2026-04-30:

- `npm audit fix` updated vulnerable transitive packages for axios/follow-redirects, brace-expansion, and path-to-regexp.
- `npm audit --audit-level=moderate` reports zero known vulnerabilities.

Keep running:

```bash
npm audit --audit-level=moderate
```

before release tagging.
