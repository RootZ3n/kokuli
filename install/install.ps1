# Kokuli Installer for Windows
# Usage: powershell -ExecutionPolicy Bypass -File install\install.ps1
param(
    [string]$RepoUrl = "https://github.com/jeffmillr/kokuli.git"
)

$ErrorActionPreference = "Stop"

$KokuliHome = Join-Path $env:USERPROFILE ".kokuli"
$KokuliBin  = Join-Path $KokuliHome "bin"
$MinNodeVersion = 18

# ---------- helpers ----------

function Write-Info  { param([string]$Msg) Write-Host "[kokuli] $Msg" -ForegroundColor Cyan }
function Write-Warn  { param([string]$Msg) Write-Host "[kokuli] $Msg" -ForegroundColor Yellow }
function Write-Err   { param([string]$Msg) Write-Host "[kokuli] $Msg" -ForegroundColor Red }

function Confirm-Prompt {
    param([string]$Prompt = "Continue? [y/N]")
    $answer = Read-Host $Prompt
    return ($answer -eq "y" -or $answer -eq "yes")
}

function Exit-Fatal {
    param([string]$Msg)
    Write-Err $Msg
    exit 1
}

# ---------- preflight ----------

function Test-NodeVersion {
    $nodePath = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodePath) {
        Exit-Fatal "Node.js is not installed. Install Node.js $MinNodeVersion+ from https://nodejs.org and try again."
    }

    $nodeVersionRaw = & node -e "process.stdout.write(process.versions.node)"
    $nodeMajor = [int]($nodeVersionRaw.Split('.')[0])
    if ($nodeMajor -lt $MinNodeVersion) {
        Exit-Fatal "Node.js $MinNodeVersion+ required (found v$nodeVersionRaw). Please upgrade: https://nodejs.org"
    }
    Write-Info "Node.js v$nodeVersionRaw detected"
}

function Test-Npm {
    $npmPath = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npmPath) {
        Exit-Fatal "npm is not installed. It usually ships with Node.js -- reinstall Node.js from https://nodejs.org"
    }
    $npmVersion = & npm --version
    Write-Info "npm v$npmVersion detected"
}

# ---------- install ----------

function Install-Source {
    $script:SourceDir = ""

    if (Test-Path "package.json") {
        $pkg = Get-Content "package.json" -Raw
        if ($pkg -match '"name":\s*"(kokuli|verum)"') {
            Write-Info "Running inside a Kokuli checkout -- using current directory as source"
            $script:SourceDir = (Get-Location).Path
        }
    }

    if (Test-Path $KokuliHome) {
        Write-Warn "Existing installation found at $KokuliHome"
        if (Confirm-Prompt "Remove and reinstall? [y/N]") {
            Remove-Item -Recurse -Force $KokuliHome
        } else {
            Exit-Fatal "Installation aborted."
        }
    }

    New-Item -ItemType Directory -Force -Path $KokuliHome | Out-Null

    if ($script:SourceDir) {
        Write-Info "Copying project files to $KokuliHome..."
        $items = Get-ChildItem -Path $script:SourceDir -Exclude "node_modules", "dist"
        foreach ($item in $items) {
            Copy-Item -Recurse -Force $item.FullName -Destination $KokuliHome
        }
    } else {
        $gitPath = Get-Command git -ErrorAction SilentlyContinue
        if ($gitPath) {
            Write-Info "Cloning Kokuli repository..."
            & git clone --depth 1 $RepoUrl $KokuliHome
            if ($LASTEXITCODE -ne 0) {
                Exit-Fatal "Failed to clone repository. Check your network or clone manually to $KokuliHome"
            }
        } else {
            Exit-Fatal "git is not installed and you are not inside a Kokuli checkout. Install git or run this script from the repo root."
        }
    }
}

function Install-Dependencies {
    Write-Info "Installing dependencies..."
    Push-Location $KokuliHome
    try {
        & npm install
        if ($LASTEXITCODE -ne 0) { Exit-Fatal "npm install failed" }
    } finally {
        Pop-Location
    }
}

function Build-Project {
    Write-Info "Building project..."
    Push-Location $KokuliHome
    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) { Exit-Fatal "npm run build failed" }
        Write-Info "Build successful"
    } finally {
        Pop-Location
    }
}

function New-Wrapper {
    New-Item -ItemType Directory -Force -Path $KokuliBin | Out-Null

    $nodeBin = (Get-Command node).Source

    $wrapperContent = @"
@echo off
"$nodeBin" "$KokuliHome\dist\engine\cli.js" %*
"@
    $kokuliCmd = Join-Path $KokuliBin "kokuli.cmd"
    Set-Content -Path $kokuliCmd -Value $wrapperContent -Encoding ASCII
    Write-Info "Wrapper script created at $kokuliCmd"

    $verumCmd = Join-Path $KokuliBin "verum.cmd"
    Set-Content -Path $verumCmd -Value $wrapperContent -Encoding ASCII
    Write-Info "Legacy wrapper script created at $verumCmd"
}

function Add-ToPath {
    $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentUserPath -split ";" | Where-Object { $_ -eq $KokuliBin }) {
        Write-Info "$KokuliBin is already in PATH"
        return
    }

    if (Confirm-Prompt "Add $KokuliBin to your user PATH? [y/N]") {
        $newPath = "$currentUserPath;$KokuliBin"
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        $env:Path = "$env:Path;$KokuliBin"
        Write-Info "Added $KokuliBin to user PATH"
        Write-Warn "You may need to restart your terminal for PATH changes to take effect"
    } else {
        Write-Warn "Skipped PATH update. Add $KokuliBin to your PATH manually."
    }
}

function Install-WindowsService {
    Write-Host ""
    Write-Info "Kokuli includes a web UI that can run as a background service."
    if (-not (Confirm-Prompt "Install Kokuli web UI as a Windows service? [y/N]")) {
        return
    }

    # Try nssm first
    $nssm = Get-Command nssm -ErrorAction SilentlyContinue
    if ($nssm) {
        $nodeBin = (Get-Command node).Source
        $serverEntry = Join-Path $KokuliHome "dist\server\index.js"

        & nssm install KokuliWeb "$nodeBin" "$serverEntry"
        & nssm set KokuliWeb AppDirectory "$KokuliHome"
        & nssm set KokuliWeb DisplayName "Kokuli Web UI"
        & nssm set KokuliWeb Description "Kokuli adversarial fracture engine web dashboard"
        & nssm set KokuliWeb Start SERVICE_AUTO_START
        Write-Info "Windows service 'KokuliWeb' installed via nssm"
        Write-Info "Start it with: nssm start KokuliWeb"
        return
    }

    # Fallback: try node-windows
    Write-Warn "nssm not found. Attempting to use node-windows..."
    Push-Location $KokuliHome
    try {
        & npm install node-windows --save
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Could not install node-windows. Install nssm (https://nssm.cc) for service support."
            return
        }

        $serviceScript = Join-Path $KokuliHome "install" "install-service.js"
        $serviceContent = @"
const { Service } = require('node-windows');
const path = require('path');
const svc = new Service({
  name: 'Kokuli Web UI',
  description: 'Kokuli adversarial fracture engine web dashboard',
  script: path.join(__dirname, '..', 'dist', 'server', 'index.js'),
  workingDirectory: path.join(__dirname, '..'),
});
svc.on('install', () => { svc.start(); console.log('Service installed and started.'); });
svc.install();
"@
        Set-Content -Path $serviceScript -Value $serviceContent -Encoding UTF8
        & node $serviceScript
        Write-Info "Windows service installed via node-windows"
    } finally {
        Pop-Location
    }
}

# ---------- main ----------

function Main {
    Write-Host ""
    Write-Host "  +=======================================+"
    Write-Host "  |   Kokuli Installer                    |"
    Write-Host "  |   Adversarial Fracture Engine          |"
    Write-Host "  +=======================================+"
    Write-Host ""

    $arch = if ([Environment]::Is64BitOperatingSystem) {
        if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
    } else { "x86" }
    Write-Info "Detected: Windows / $arch"

    Test-NodeVersion
    Test-Npm

    Install-Source
    Install-Dependencies
    Build-Project
    New-Wrapper
    Add-ToPath

    Install-WindowsService

    Write-Host ""
    Write-Info "============================================"
    Write-Info "  Kokuli installed successfully!"
    Write-Info "============================================"
    Write-Host ""
    Write-Info "Next steps:"
    Write-Info "  kokuli list           -- list available tests"
    Write-Info "  kokuli suite all      -- run all test suites"
    Write-Info "  kokuli report summary -- view latest report"
    Write-Host ""
    Write-Info "Web UI:    cd $KokuliHome; npm run web  (or start the service)"
    Write-Info "Docs:      $KokuliHome\docs\"
    Write-Info "Uninstall: powershell $KokuliHome\install\uninstall.ps1"
    Write-Host ""
}

Main
