# Lab Workflow

## Machines

### Mushin (Primary)
- **Role**: Squidley V2 host, primary test target
- **Hardware**: Intel i7-13700K, NVIDIA RTX 4070
- **OS**: Debian 12
- **Squidley**: V2 with hardened gateway, Velum privacy layer, multi-model routing
- **Endpoint**: `http://100.118.60.13:18791/chat`
- **Tailscale IP**: `100.118.60.13`

### Pop Tart (Compute / Trust Testing)
- **Role**: Kokuli host, compute node, defensive trust-testing machine
- **Hardware**: AMD RX 6800, 32GB DDR5
- **OS**: Pop!_OS
- **Services**:
  - Ollama (systemd, always-on, port 11434)
  - Kokuli CLI (`npm run dev`)
  - Kokuli Web UI (`npm run web`, port 3000)
  - Pop Tart Worker (systemd, port 8765)
- **Repo**: `/path/to/kokuli`

### Zen Pop (Retired)
ZenPop no longer exists. It has been replaced by Mushin.

## Network

All inter-machine communication uses **Tailscale**.

| Machine | Tailscale IP | Key Ports |
|---------|-------------|-----------|
| Mushin | 100.118.60.13 | 18791 (Squidley V2) |
| Pop Tart | (local) | 3000 (Kokuli Web), 8765 (Worker), 11434 (Ollama) |

## Workflow

### Running Tests

```bash
# CLI (primary interface)
npm run dev -- suite all           # Run all tests
npm run dev -- run gateway-refusal-basic  # Run single test
npm run dev -- list                # List available tests

# Web UI (companion)
npm run web                        # Start dashboard on port 3000
# Open http://localhost:3000       # Security dashboard
# Open http://localhost:3000/atlantis  # Learning portal
```

### Test Flow

1. Kokuli loads test definition from `tests/`
2. Resolves target from `config/targets.json`
3. Sends request to Squidley V2 on Mushin over Tailscale
4. Parses SSE streaming response, assembles chunks, extracts receipt
5. Evaluates deterministically against expected behavior
6. Writes JSON + Markdown report to `reports/latest/`

### Release Gate (Future)

Planned workflow: Mushin (dev) -> Kokuli validation -> Pop Tart (release candidate)

All tests must PASS before a Squidley build is promoted from Mushin to Pop Tart.

## Services

### Ollama (Pop Tart)
- Systemd service: `ollama.service`
- Starts on boot, always running
- Bound to `0.0.0.0:11434`

### Pop Tart Worker
- Systemd service: `poptart-worker.service`
- FastAPI/uvicorn on port 8765
- Working directory: `/path/to/squidley-worker/`
