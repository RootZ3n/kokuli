# Krakzen Uninstaller for Windows
# Usage: powershell -ExecutionPolicy Bypass -File install\uninstall.ps1

$ErrorActionPreference = "Stop"

$KrakzenHome = Join-Path $env:USERPROFILE ".krakzen"
$KrakzenBin  = Join-Path $KrakzenHome "bin"

function Write-Info { param([string]$Msg) Write-Host "[krakzen] $Msg" -ForegroundColor Cyan }
function Write-Warn { param([string]$Msg) Write-Host "[krakzen] $Msg" -ForegroundColor Yellow }

function Confirm-Prompt {
    param([string]$Prompt = "Continue? [y/N]")
    $answer = Read-Host $Prompt
    return ($answer -eq "y" -or $answer -eq "yes")
}

Write-Host ""
Write-Host "  Krakzen Uninstaller"
Write-Host ""

if (-not (Confirm-Prompt "This will remove Krakzen from your system. Continue? [y/N]")) {
    Write-Info "Aborted."
    exit 0
}

# ---------- remove Windows service ----------

$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssm) {
    $svcStatus = & nssm status KrakzenWeb 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Stopping and removing Windows service..."
        & nssm stop KrakzenWeb 2>$null
        & nssm remove KrakzenWeb confirm 2>$null
        Write-Info "Windows service removed"
    }
} else {
    # Try node-windows cleanup
    $serviceScript = Join-Path $KrakzenHome "install" "uninstall-service.js"
    if (Test-Path (Join-Path $KrakzenHome "node_modules" "node-windows")) {
        Write-Info "Removing node-windows service..."
        $uninstallContent = @"
const { Service } = require('node-windows');
const path = require('path');
const svc = new Service({
  name: 'Krakzen Web UI',
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
if ($currentUserPath -and $currentUserPath.Contains($KrakzenBin)) {
    Write-Info "Removing $KrakzenBin from user PATH..."
    $segments = $currentUserPath -split ";" | Where-Object { $_ -ne $KrakzenBin -and $_ -ne "" }
    $newPath = $segments -join ";"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Info "PATH updated"
}

# ---------- remove install directory ----------

if (Test-Path $KrakzenHome) {
    Write-Info "Removing $KrakzenHome..."
    Remove-Item -Recurse -Force $KrakzenHome
    Write-Info "Installation directory removed"
} else {
    Write-Warn "No installation found at $KrakzenHome"
}

Write-Host ""
Write-Info "Krakzen has been uninstalled."
Write-Host ""
