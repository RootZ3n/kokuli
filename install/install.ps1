# Krakzen Installer for Windows
# Usage: powershell -ExecutionPolicy Bypass -File install\install.ps1

$ErrorActionPreference = "Stop"

$KrakzenHome = Join-Path $env:USERPROFILE ".krakzen"
$KrakzenBin  = Join-Path $KrakzenHome "bin"
$RepoUrl     = "https://github.com/jeffmillr/krakzen.git"
$MinNodeVersion = 18

# ---------- helpers ----------

function Write-Info  { param([string]$Msg) Write-Host "[krakzen] $Msg" -ForegroundColor Cyan }
function Write-Warn  { param([string]$Msg) Write-Host "[krakzen] $Msg" -ForegroundColor Yellow }
function Write-Err   { param([string]$Msg) Write-Host "[krakzen] $Msg" -ForegroundColor Red }

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
        if ($pkg -match '"name":\s*"krakzen"') {
            Write-Info "Running inside a Krakzen checkout -- using current directory as source"
            $script:SourceDir = (Get-Location).Path
        }
    }

    if (Test-Path $KrakzenHome) {
        Write-Warn "Existing installation found at $KrakzenHome"
        if (Confirm-Prompt "Remove and reinstall? [y/N]") {
            Remove-Item -Recurse -Force $KrakzenHome
        } else {
            Exit-Fatal "Installation aborted."
        }
    }

    New-Item -ItemType Directory -Force -Path $KrakzenHome | Out-Null

    if ($script:SourceDir) {
        Write-Info "Copying project files to $KrakzenHome..."
        $items = Get-ChildItem -Path $script:SourceDir -Exclude "node_modules", "dist"
        foreach ($item in $items) {
            Copy-Item -Recurse -Force $item.FullName -Destination $KrakzenHome
        }
    } else {
        $gitPath = Get-Command git -ErrorAction SilentlyContinue
        if ($gitPath) {
            Write-Info "Cloning Krakzen repository..."
            & git clone --depth 1 $RepoUrl $KrakzenHome
            if ($LASTEXITCODE -ne 0) {
                Exit-Fatal "Failed to clone repository. Check your network or clone manually to $KrakzenHome"
            }
        } else {
            Exit-Fatal "git is not installed and you are not inside a Krakzen checkout. Install git or run this script from the repo root."
        }
    }
}

function Install-Dependencies {
    Write-Info "Installing dependencies..."
    Push-Location $KrakzenHome
    try {
        & npm install
        if ($LASTEXITCODE -ne 0) { Exit-Fatal "npm install failed" }
    } finally {
        Pop-Location
    }
}

function Build-Project {
    Write-Info "Building TypeScript..."
    Push-Location $KrakzenHome
    try {
        & npx tsc -p tsconfig.json
        if ($LASTEXITCODE -ne 0) { Exit-Fatal "TypeScript build failed" }
        Write-Info "Build successful"
    } finally {
        Pop-Location
    }
}

function New-Wrapper {
    New-Item -ItemType Directory -Force -Path $KrakzenBin | Out-Null

    $nodeBin = (Get-Command node).Source

    $wrapperContent = @"
@echo off
"$nodeBin" "$KrakzenHome\dist\engine\cli.js" %*
"@
    $wrapperBat = Join-Path $KrakzenBin "krakzen.cmd"
    Set-Content -Path $wrapperBat -Value $wrapperContent -Encoding ASCII
    Write-Info "Wrapper script created at $wrapperBat"
}

function Add-ToPath {
    $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentUserPath -split ";" | Where-Object { $_ -eq $KrakzenBin }) {
        Write-Info "$KrakzenBin is already in PATH"
        return
    }

    if (Confirm-Prompt "Add $KrakzenBin to your user PATH? [y/N]") {
        $newPath = "$currentUserPath;$KrakzenBin"
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        $env:Path = "$env:Path;$KrakzenBin"
        Write-Info "Added $KrakzenBin to user PATH"
        Write-Warn "You may need to restart your terminal for PATH changes to take effect"
    } else {
        Write-Warn "Skipped PATH update. Add $KrakzenBin to your PATH manually."
    }
}

function Install-WindowsService {
    Write-Host ""
    Write-Info "Krakzen includes a web UI that can run as a background service."
    if (-not (Confirm-Prompt "Install Krakzen web UI as a Windows service? [y/N]")) {
        return
    }

    # Try nssm first
    $nssm = Get-Command nssm -ErrorAction SilentlyContinue
    if ($nssm) {
        $nodeBin = (Get-Command node).Source
        $tsNodePath = Join-Path $KrakzenHome "node_modules\.bin\ts-node.cmd"
        $serverEntry = Join-Path $KrakzenHome "server\index.ts"

        & nssm install KrakzenWeb "$nodeBin" "$tsNodePath $serverEntry"
        & nssm set KrakzenWeb AppDirectory "$KrakzenHome"
        & nssm set KrakzenWeb DisplayName "Krakzen Web UI"
        & nssm set KrakzenWeb Description "Krakzen adversarial validation web dashboard"
        & nssm set KrakzenWeb Start SERVICE_AUTO_START
        Write-Info "Windows service 'KrakzenWeb' installed via nssm"
        Write-Info "Start it with: nssm start KrakzenWeb"
        return
    }

    # Fallback: try node-windows
    Write-Warn "nssm not found. Attempting to use node-windows..."
    Push-Location $KrakzenHome
    try {
        & npm install node-windows --save
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Could not install node-windows. Install nssm (https://nssm.cc) for service support."
            return
        }

        $serviceScript = Join-Path $KrakzenHome "install" "install-service.js"
        $serviceContent = @"
const { Service } = require('node-windows');
const path = require('path');
const svc = new Service({
  name: 'Krakzen Web UI',
  description: 'Krakzen adversarial validation web dashboard',
  script: path.join(__dirname, '..', 'node_modules', '.bin', 'ts-node'),
  scriptOptions: path.join(__dirname, '..', 'server', 'index.ts'),
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
    Write-Host "  |   Krakzen Installer                   |"
    Write-Host "  |   Adversarial Validation Framework    |"
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
    Write-Info "  Krakzen installed successfully!"
    Write-Info "============================================"
    Write-Host ""
    Write-Info "Next steps:"
    Write-Info "  krakzen list           -- list available tests"
    Write-Info "  krakzen suite all      -- run all test suites"
    Write-Info "  krakzen report summary -- view latest report"
    Write-Host ""
    Write-Info "Web UI:    krakzen web  (or start the service)"
    Write-Info "Docs:      $KrakzenHome\docs\"
    Write-Info "Uninstall: powershell $KrakzenHome\install\uninstall.ps1"
    Write-Host ""
}

Main
