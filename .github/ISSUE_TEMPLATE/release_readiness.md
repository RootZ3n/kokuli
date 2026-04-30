---
name: Release readiness checklist
about: Track RC readiness without posting sensitive evidence
title: "[Release]: "
labels: release
assignees: ""
---

## Release Candidate

Version or commit:

## Verification

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run test:logic`
- [ ] `npm run smoke`
- [ ] `npm run verify:release`
- [ ] `npm audit --audit-level=moderate`

## Safety Defaults

- [ ] Web binds to `127.0.0.1` by default.
- [ ] Live network ops require `VERUM_ENABLE_NETWORK_OPS=1`.
- [ ] Live checks require ownership confirmation.
- [ ] Public targets are blocked.
- [ ] Reports are redacted/summarized before write.
- [ ] `/reports` access is gated.

## Notes

Do not attach raw reports unless they have been reviewed and sanitized.
