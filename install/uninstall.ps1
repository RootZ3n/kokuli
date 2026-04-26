# Verum Uninstaller for Windows
# Usage: powershell -ExecutionPolicy Bypass -File install\uninstall.ps1

$ErrorActionPreference = "Stop"

$VerumHome = Join-Path $env:USERPROFILE ".verum"
$VerumBin  = Join-Path $VerumHome "bin"

function Write-Info { param([string]$Msg) Write-Host "[verum] $Msg" -ForegroundColor Cyan }
function Write-Warn { param([string]$Msg) Write-Host "[verum] $Msg" -ForegroundColor Yellow }

function Confirm-Prompt {
    param([string]$Prompt = "Continue? [y/N]")
    $answer = Read-Host $Prompt
    return ($answer -eq "y" -or $answer -eq "yes")
}

Write-Host ""
Write-Host "  Verum Uninstaller"
Write-Host ""

if (-not (Confirm-Prompt "This will remove Verum from your system. Continue? [y/N]")) {
    Write-Info "Aborted."
    exit 0
}

# ---------- remove Windows service ----------

$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssm) {
    $svcStatus = & nssm status VerumWeb 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Stopping and removing Windows service..."
        & nssm stop VerumWeb 2>$null
        & nssm remove VerumWeb confirm 2>$null
        Write-Info "Windows service removed"
    }
} else {
    # Try node-windows cleanup
    $serviceScript = Join-Path $VerumHome "install" "uninstall-service.js"
    if (Test-Path (Join-Path $VerumHome "node_modules" "node-windows")) {
        Write-Info "Removing node-windows service..."
        $uninstallContent = @"
const { Service } = require('node-windows');
const path = require('path');
const svc = new Service({
  name: 'Verum Web UI',
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

# ---------- remove from PATH ----------

$currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentUserPath -and $currentUserPath.Contains($VerumBin)) {
    Write-Info "Removing $VerumBin from user PATH..."
    $segments = $currentUserPath -split ";" | Where-Object { $_ -ne $VerumBin -and $_ -ne "" }
    $newPath = $segments -join ";"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Info "PATH updated"
}

# ---------- remove install directory ----------

if (Test-Path $VerumHome) {
    Write-Info "Removing $VerumHome..."
    Remove-Item -Recurse -Force $VerumHome
    Write-Info "Installation directory removed"
} else {
    Write-Warn "No installation found at $VerumHome"
}

Write-Host ""
Write-Info "Verum has been uninstalled."
Write-Host ""
