# Kokuli Uninstaller for Windows
# Usage: powershell -ExecutionPolicy Bypass -File install\uninstall.ps1

$ErrorActionPreference = "Stop"

$KokuliHome = Join-Path $env:USERPROFILE ".kokuli"
$KokuliBin  = Join-Path $KokuliHome "bin"
$LegacyHome = Join-Path $env:USERPROFILE ".verum"
$LegacyBin  = Join-Path $LegacyHome "bin"

function Write-Info { param([string]$Msg) Write-Host "[kokuli] $Msg" -ForegroundColor Cyan }
function Write-Warn { param([string]$Msg) Write-Host "[kokuli] $Msg" -ForegroundColor Yellow }

function Confirm-Prompt {
    param([string]$Prompt = "Continue? [y/N]")
    $answer = Read-Host $Prompt
    return ($answer -eq "y" -or $answer -eq "yes")
}

Write-Host ""
Write-Host "  Kokuli Uninstaller"
Write-Host ""

if (-not (Confirm-Prompt "This will remove Kokuli from your system. Continue? [y/N]")) {
    Write-Info "Aborted."
    exit 0
}

# ---------- remove Windows service ----------

$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssm) {
    foreach ($svcName in @("KokuliWeb", "VerumWeb")) {
        $svcStatus = & nssm status $svcName 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Info "Stopping and removing Windows service '$svcName'..."
            & nssm stop $svcName 2>$null
            & nssm remove $svcName confirm 2>$null
            Write-Info "Windows service '$svcName' removed"
        }
    }
} else {
    # Try node-windows cleanup from whichever home exists
    foreach ($homeDir in @($KokuliHome, $LegacyHome)) {
        if (Test-Path (Join-Path $homeDir "node_modules" "node-windows")) {
            Write-Info "Removing node-windows service from $homeDir..."
            $serviceScript = Join-Path $homeDir "install" "uninstall-service.js"
            $uninstallContent = @"
const { Service } = require('node-windows');
const path = require('path');
const svc = new Service({
  name: 'Kokuli Web UI',
  script: path.join(__dirname, '..', 'node_modules', '.bin', 'ts-node'),
});
svc.on('uninstall', () => { console.log('Service removed.'); });
svc.uninstall();
"@
            Set-Content -Path $serviceScript -Value $uninstallContent -Encoding UTF8
            & node $serviceScript 2>$null
            Remove-Item -Force $serviceScript -ErrorAction SilentlyContinue
            Write-Info "Windows service removed"
        }
    }
}

# ---------- remove from PATH ----------

$currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentUserPath) {
    $pathChanged = $false
    $segments = $currentUserPath -split ";" | Where-Object { $_ -ne "" }
    foreach ($binDir in @($KokuliBin, $LegacyBin)) {
        if ($segments -contains $binDir) {
            Write-Info "Removing $binDir from user PATH..."
            $segments = $segments | Where-Object { $_ -ne $binDir }
            $pathChanged = $true
        }
    }
    if ($pathChanged) {
        $newPath = $segments -join ";"
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Info "PATH updated"
    }
}

# ---------- remove install directories ----------

foreach ($dir in @($KokuliHome, $LegacyHome)) {
    if (Test-Path $dir) {
        Write-Info "Removing $dir..."
        Remove-Item -Recurse -Force $dir
        Write-Info "Directory removed: $dir"
    }
}

Write-Host ""
Write-Info "Kokuli has been uninstalled."
Write-Host ""
