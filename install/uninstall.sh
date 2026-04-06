#!/usr/bin/env bash
# Krakzen Uninstaller for Linux and macOS
set -euo pipefail

KRAKZEN_HOME="${HOME}/.krakzen"
SYMLINK_PATH="/usr/local/bin/krakzen"

info()  { printf "\033[1;34m[krakzen]\033[0m %s\n" "$*"; }
warn()  { printf "\033[1;33m[krakzen]\033[0m %s\n" "$*"; }
error() { printf "\033[1;31m[krakzen]\033[0m %s\n" "$*" >&2; }

confirm() {
  local prompt="${1:-Continue?} [y/N] "
  read -r -p "$prompt" answer
  [[ "${answer,,}" == "y" || "${answer,,}" == "yes" ]]
}

echo ""
echo "  Krakzen Uninstaller"
echo ""

if ! confirm "This will remove Krakzen from your system. Continue?"; then
  info "Aborted."
  exit 0
fi

# ---------- remove systemd service (Linux) ----------

if [[ "$(uname -s)" == "Linux" ]] && command -v systemctl &>/dev/null; then
  if systemctl list-unit-files krakzen-web.service &>/dev/null; then
    info "Stopping and removing systemd service..."
    sudo systemctl stop krakzen-web.service 2>/dev/null || true
    sudo systemctl disable krakzen-web.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/krakzen-web.service
    sudo systemctl daemon-reload
    info "systemd service removed"
  fi
fi

# ---------- remove launchd plist (macOS) ----------

if [[ "$(uname -s)" == "Darwin" ]]; then
  local_plist="${HOME}/Library/LaunchAgents/com.krakzen.web.plist"
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

if [[ -d "${KRAKZEN_HOME}" ]]; then
  info "Removing ${KRAKZEN_HOME}..."
  rm -rf "${KRAKZEN_HOME}"
  info "Installation directory removed"
else
  warn "No installation found at ${KRAKZEN_HOME}"
fi

echo ""
info "Krakzen has been uninstalled."
echo ""
