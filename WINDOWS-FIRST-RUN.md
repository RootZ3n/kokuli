# Verum Windows First Run

This RC uses the PowerShell installer. There is no MSI, native executable, Docker image, or Electron/Tauri installer.

## Package/install method

From a Verum checkout:

```powershell
powershell -ExecutionPolicy Bypass -File install\install.ps1
```

If running without a checkout, the installer clones the configured repository URL. The Windows installer default matches the Linux/macOS installer default; confirm during VM testing that it resolves to the intended public release repo.

## Prerequisites

- Windows 10/11 with PowerShell or Windows Terminal.
- Node.js 18 or newer.
- npm 9 or newer.
- Git for Windows if the installer needs to clone.
- Browser: Edge, Chrome, or Firefox.
- A local, staging, or explicitly authorized target for real tests.

Ollama and Python are not required for the core RC smoke path.

## Configure `.env`

If you need a persistent web token or port override:

```powershell
Copy-Item .env.example .env
```

Recommended first local web settings:

```text
VERUM_HOST=127.0.0.1
VERUM_PORT=3000
```

## Exact test commands

```powershell
powershell -ExecutionPolicy Bypass -File install\install.ps1
```

Open a new PowerShell if you accepted the PATH update:

```powershell
verum list
```

To start the web dashboard without the optional Windows service:

```powershell
cd $env:USERPROFILE\.verum
npm run web
```

Open:

```text
http://127.0.0.1:3000
```

## Expected output

`verum list` should start with:

```text
[verum] Available tests:
```

`npm run web` should print:

```text
[verum-web] Dashboard:  http://127.0.0.1:3000
[verum-web] Atlantis:   http://127.0.0.1:3000/atlantis
[verum-web] API:        http://127.0.0.1:3000/api
```

## Cleanup

```powershell
powershell -ExecutionPolicy Bypass -File $env:USERPROFILE\.verum\install\uninstall.ps1
```

If you manually created `.env` or report/state folders outside `$env:USERPROFILE\.verum`, remove those separately.

## Known RC gaps

- Native Windows has not been personally verified yet.
- The installer is source-based and requires Node/npm.
- Optional service mode requires `nssm` or falls back to installing `node-windows`.
- The CLI does not expose a `verum web` command; use `npm run web` from `$env:USERPROFILE\.verum` unless service mode is installed.
