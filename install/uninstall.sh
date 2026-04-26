#!/usr/bin/env bash
# Verum Uninstaller for Linux and macOS
set -euo pipefail

KRAUM_HOME="${HOME}/.verum"
SYMLINK_PATH="/usr/local/bin/verum"

info()  { printf "\033[1;34m[verum]\033[0m %s\n" "$*"; }
warn()  { printf "\033[1;33m[verum]\033[0m %s\n" "$*"; }
error() { printf "\033[1;31m[verum]\033[0m %s\n" "$*" >&2; }

confirm() {
  local prompt="${1:-Continue?} [y/N] "
  read -r -p "$prompt" answer
  [[ "${answer,,}" == "y" || "${answer,,}" == "yes" ]]
}

echo ""
echo "  Verum Uninstaller"
echo ""

if ! confirm "This will remove Verum from your system. Continue?"; then
  info "Aborted."
  exit 0
fi

# ---------- remove systemd service (Linux) ----------

if [[ "$(uname -s)" == "Linux" ]] && command -v systemctl &>/dev/null; then
  if systemctl list-unit-files verum-web.service &>/dev/null; then
    info "Stopping and removing systemd service..."
    sudo systemctl stop verum-web.service 2>/dev/null || true
    sudo systemctl disable verum-web.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/verum-web.service
    sudo systemctl daemon-reload
    info "systemd service removed"
  fi
fi

# ---------- remove launchd plist (macOS) ----------

if [[ "$(uname -s)" == "Darwin" ]]; then
  local_plist="${HOME}/Library/LaunchAgents/com.verum.web.plist"
  if [[ -f "${local_plist}" ]]; then
    info "Unloading and removing launchd plist..."
    launchctl unload "${local_plist}" 2>/dev/null || true
    rm -f "${local_plist}"
    info "launchd plist removed"
  fi
fi

# ---------- remove symlink ----------

if [[ -L "${SYMLINK_PATH}" ]]; then
  info "Removing symlink at ${SYMLINK_PATH}..."
  if [[ -w "$(dirname "${SYMLINK_PATH}")" ]]; then
    rm -f "${SYMLINK_PATH}"
  else
    sudo rm -f "${SYMLINK_PATH}"
  fi
  info "Symlink removed"
fi

# ---------- remove install directory ----------

if [[ -d "${KRAUM_HOME}" ]]; then
  info "Removing ${KRAUM_HOME}..."
  rm -rf "${KRAUM_HOME}"
  info "Installation directory removed"
else
  warn "No installation found at ${KRAUM_HOME}"
fi

echo ""
info "Verum has been uninstalled."
echo ""
