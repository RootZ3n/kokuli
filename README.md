# Krakzen

**From the depths, we hunt.**

Krakzen is an adversarial security validation framework. It probes AI-powered products for vulnerabilities, enforces safety standards, and generates auditable reports with full transparency.

Built for teams shipping AI products to the public — especially products used by children.

## What It Does

- Scans every endpoint of a target for security vulnerabilities
- Tests prompt injection, jailbreaks, data exfiltration, and auth bypass
- Runs child safety validation for products used by minors (COPPA-grade)
- Fuzzes inputs with unicode abuse, SQL injection, polyglot payloads, and more
- Executes multi-turn attack chains that simulate real adversarial behavior
- Generates structured JSON and Markdown reports with full receipts
- Tracks model usage, token consumption, and cost per test
- Enforces release gates with pass/fail thresholds
- Teaches security concepts through a gamified learning module

## Installation

### Prerequisites

- Node.js 18+ and npm
- Network access to the target(s) you want to test

### Quick Start

```bash
git clone <repo-url> krakzen
cd krakzen
npm install
```

### Verify Installation

```bash
# List all available tests
npm run dev -- list

# Show active target
npm run dev -- target

# Probe target connectivity
npm run dev -- target probe
```

### Cross-Platform Install (npm global)

```bash
npm install -g krakzen
krakzen list
krakzen target probe
```

### Standalone Installers

Pre-built binaries are available for:

| Platform | Download | Notes |
|----------|----------|-------|
| Linux (x64) | `krakzen-linux-x64` | Tested on Debian 12, Ubuntu 22.04, Pop!_OS |
| macOS (arm64) | `krakzen-macos-arm64` | Apple Silicon (M1+) |
| macOS (x64) | `krakzen-macos-x64` | Intel Macs |
| Windows (x64) | `krakzen-win-x64.exe` | Windows 10/11 |

See [install/](install/) for platform-specific setup scripts.

## Target Management

Krakzen can test any HTTP-based AI product. Configure multiple targets and switch between them.

```bash
# Show the active target
npm run dev -- target

# List all configured targets
npm run dev -- target list

# Switch the active target
npm run dev -- target set squidley-lite

# Add a new target
npm run dev -- target add my-product http://192.168.1.100:8080 \
  --chat /api/chat \
  --format messages \
  --notes "My AI product"

# Remove a target
npm run dev -- target remove old-target

# Test connectivity to the active target
npm run dev -- target probe

# Override target for a single command
npm run dev -- run gateway-refusal-basic --target my-product
npm run dev -- suite security --target my-product
```

## Running Tests

### Single Test

```bash
npm run dev -- run <test-id>
npm run dev -- run gateway-refusal-basic
npm run dev -- run health-info-leak --target my-product
```

### Test Suites

```bash
# Run all tests in a category
npm run dev -- suite security
npm run dev -- suite child-safety
npm run dev -- suite recon

# Run every test
npm run dev -- suite all

# Run the locked release gate
npm run dev -- suite baseline
```

### List Tests

```bash
npm run dev -- list              # All tests
npm run dev -- list security     # Tests in one category
```

## Test Categories

| Category | Tests | Priority | What It Finds |
|----------|-------|----------|---------------|
| **child-safety** | 12 | CRITICAL | Jailbreaks through educational framing, PII collection from minors, grooming patterns, harmful content bypass, cyberbullying assistance |
| **security** | 6 | High | Prompt injection, system prompt extraction, instruction hierarchy bypass, gateway refusal |
| **recon** | 8 | High | Unauthenticated endpoints, internal module exposure, tool registry leaks, memory store access |
| **auth** | 8 | High | Missing authentication, session enumeration, CORS misconfiguration, unauthorized data access |
| **exfil** | 8 | High | Conversation history leaks, config path disclosure, provider key exposure, search index data mining |
| **multi-turn** | 4 | High | Gradual trust escalation, context window poisoning, role-play jailbreaks, multi-step grooming |
| **fuzzing** | 3 | Medium | Unicode abuse, SQL injection, XSS payloads, null bytes, oversized inputs, path traversal, encoding tricks |
| **reliability** | 2 | Medium | Malformed input handling, input sanitization |
| **architecture** | 2 | Medium | Receipt field presence, response structure validation |

### Fuzzing Mutations

The fuzzing engine generates mutated payloads using 10 mutation types:

- `unicode_abuse` — zero-width chars, RTL overrides, homoglyph substitution
- `encoding_tricks` — HTML entities, URL encoding, base64 fragments, mixed UTF-8
- `control_chars` — null bytes, escape sequences, ANSI codes
- `oversized` — 10K-100K character payloads, empty inputs
- `nested_injection` — JSON-in-JSON, XML tags, template literals
- `polyglot` — combined SQL/XSS/shell/prompt injection
- `null_bytes` — strategic null byte insertion at word boundaries
- `format_string` — %s, %x, ${}, {{}} template patterns
- `sql_fragments` — OR 1=1, UNION SELECT, DROP TABLE patterns
- `path_traversal` — ../../../etc/passwd, URL-encoded traversal

## Transparency

Every test execution produces a receipt with full operational transparency:

- **Model**: Which AI model handled the request
- **Provider**: Which provider routed the request
- **Tokens**: Input and output token counts
- **Cost**: Estimated cost per request
- **Duration**: Server-side and total request duration
- **Routing**: Task tier, escalation status, routing decision ID
- **Gateway**: Block status, reason codes, guard events

Reports include:
- Per-test receipts with all fields above
- Receipt health checks (was each field present?)
- Aggregate token/cost summaries per suite
- Raw response snippets for manual review

## Web UI

```bash
npm run web
```

- **Dashboard** (`http://localhost:3000`) — Test registry, run controls, target selector, category overview, receipt health, detail panels
- **Atlantis** (`http://localhost:3000/atlantis`) — Security learning portal

The web UI includes:
- Target selector dropdown with connectivity probe
- Category-by-category pass/fail bars
- Severity-coded test rows with one-click execution
- Expandable detail panels with receipt data and raw responses
- Suite launch controls for all 10 categories

### API

All dashboard functionality is available via REST API:

```bash
# Tests
GET  /api/tests                    # List all tests
POST /api/tests/:id/run            # Run a single test
POST /api/suite/:category          # Run a suite

# Targets
GET  /api/targets                  # List targets
POST /api/targets/active           # Set active target
POST /api/targets                  # Add a target
DELETE /api/targets/:key           # Remove a target
POST /api/targets/:key/probe       # Probe connectivity

# Reports
GET  /api/reports/summary          # Latest suite summary
GET  /api/reports/latest           # All latest reports
```

## Baseline Release Gate

A locked set of tests that must pass before any product ships:

```bash
npm run dev -- suite baseline
```

Threshold: **PASS >= 6, WARN <= 3, FAIL = 0**

Exits with code 1 on failure — designed for CI/CD integration.

## Reports

Every test run generates:
- `reports/latest/<test-id>.json` — structured result with all fields
- `reports/latest/<test-id>.md` — human-readable markdown report
- `reports/latest/SUMMARY.json` — suite aggregate
- `reports/latest/SUMMARY.md` — suite summary table

## Learning Module — The Lost City of Atlantis

Optional gamified security education. Zero dependency on core testing engine.

```bash
npm run dev -- realm status        # View progress
npm run dev -- realm zone gates    # Enter a zone
npm run dev -- learn               # List curriculum modules
npm run dev -- learn firewalls     # Study a module
```

**Realm Mode** — Navigate Atlantis, face creatures that embody security threats, answer quizzes to defeat them, earn XP.

| Creature | Concept | Difficulty |
|----------|---------|------------|
| Sentinel Golem | Firewalls | 1 |
| Mimic | Prompt Injection | 2 |
| Siren | Social Engineering | 3 |
| Shadow Wraith | Data Exfiltration | 4 |
| Hydra | DDoS Mitigation | 5 |
| Leviathan | AI Security (Boss) | 10 |

**Linear Curriculum** — Structured modules covering firewalls, prompt injection, and social engineering fundamentals.

## Architecture

```
engine/
  cli.ts            — CLI with target management, suite runner, arg parser
  client.ts         — HTTP client: SSE parsing, receipt extraction, retry logic, generic endpoint requests
  evaluator.ts      — Deterministic evaluation: refusal, leak, auth, PII, harmful content, child safety
  fuzzer.ts         — Payload mutation engine (10 mutation types)
  loaders.ts        — Test/target CRUD, active target resolution
  reportWriter.ts   — JSON + Markdown report generation
  types.ts          — All type definitions

server/
  index.ts          — Express server
  api.ts            — REST API (tests, targets, reports, realm, curriculum)
  public/           — Dashboard and Atlantis UI

learning/
  cli.ts            — Learning command router
  realm.ts          — Atlantis zone/creature logic
  curriculum-runner.ts — Linear curriculum
  state.ts          — Player XP/level persistence
  data/             — Zones, creatures, curriculum, player state

tests/
  security/         — Prompt injection, refusal, system prompt protection
  recon/            — Endpoint discovery, information leakage
  auth/             — Authentication and authorization
  exfil/            — Data exfiltration
  child-safety/     — Magister child protection (CRITICAL)
  multi-turn/       — Multi-step attack chains
  fuzzing/          — Automated input mutation
  reliability/      — Input handling
  architecture/     — Receipt and structure validation
  baseline/         — Locked release gate manifest

config/
  targets.json      — Target definitions and endpoint map
  routing.json      — Judge routing philosophy
  safety.json       — Security policy flags

reports/
  latest/           — Most recent test results (JSON + Markdown)
```

## Key Design Decisions

- **CLI-first**: Every feature works from the command line. The web UI is a companion, not a requirement.
- **Deterministic evaluation**: Pattern matching and rule-based assertions. No AI judging (yet). Results are reproducible.
- **Target-agnostic**: Tests don't care what product they're hitting. Point Krakzen at anything.
- **Receipts everywhere**: Every test execution has a traceable receipt with model, tokens, cost, and duration.
- **Child safety as first class**: Not an afterthought. It's the highest-priority test category with the most tests.
- **Removable learning module**: Delete `learning/` and everything else still works.

## Configuration

### targets.json

```json
{
  "defaultTarget": "my-product",
  "targets": {
    "my-product": {
      "name": "My Product",
      "baseUrl": "http://localhost:8080",
      "chatPath": "/chat",
      "payloadFormat": "messages",
      "notes": "Local development instance"
    }
  }
}
```

### Payload Formats

- `messages`: `{ "messages": [{ "role": "user", "content": "..." }] }`
- `input`: `{ "input": "..." }`

### Environment Variables

- `KRAKZEN_PORT` — Web UI port (default: 3000)

## Writing Custom Tests

Create a JSON file in the appropriate `tests/<category>/` directory:

```json
{
  "id": "custom-001",
  "name": "My Custom Test",
  "category": "security",
  "target": "my-product",
  "purpose": "Describe what this test validates.",
  "input": "The prompt to send to the target.",
  "expectedBehavior": {
    "shouldRefuse": true,
    "shouldRevealSystemPrompt": false
  },
  "severity": "high"
}
```

### Endpoint Tests

```json
{
  "id": "custom-002",
  "name": "Check Auth on /admin",
  "category": "auth",
  "target": "my-product",
  "purpose": "Verify /admin requires authentication.",
  "input": "",
  "endpoint": "/admin",
  "method": "GET",
  "expectedBehavior": {
    "shouldRequireAuth": true
  },
  "severity": "high"
}
```

### Available Assertions

| Assertion | What It Checks |
|-----------|---------------|
| `shouldRefuse` | Model refuses or gateway blocks |
| `shouldRevealSystemPrompt` | System prompt leak detection |
| `shouldErrorSafely` | Graceful failure on bad input |
| `shouldReturnContent` | Non-empty response |
| `shouldHaveReceipt` | Receipt metadata present |
| `shouldRequireAuth` | Endpoint returns 401/403 |
| `shouldNotExposeInternals` | No internal paths, module names, IPs |
| `shouldNotExposePII` | No email, SSN, phone, credit card patterns |
| `shouldNotExposeConfig` | No config paths or secrets |
| `shouldBlockHarmfulContent` | No violent, sexual, drug, weapon content |
| `shouldEnforceAgeAppropriate` | Child-safe response |
| `shouldProtectMinorPII` | COPPA-grade PII protection |
| `shouldNotLeakData` | Combined internal + PII check |
| `expectedStatus` | Exact HTTP status code |
| `expectedStatusRange` | HTTP status within range |

## License

Proprietary. All rights reserved.
