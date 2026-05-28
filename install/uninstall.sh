#!/usr/bin/env bash
# Kokuli Uninstaller for Linux and macOS
# Also cleans up legacy ~/.verum installations
set -euo pipefail

KRAUM_HOME="${HOME}/.kokuli"
LEGACY_HOME="${HOME}/.verum"
SYMLINK_PATH="/usr/local/bin/kokuli"
LEGACY_SYMLINK="/usr/local/bin/verum"

info()  { printf "\033[1;34m[kokuli]\033[0m %s\n" "$*"; }
warn()  { printf "\033[1;33m[kokuli]\033[0m %s\n" "$*"; }
error() { printf "\033[1;31m[kokuli]\033[0m %s\n" "$*" >&2; }

confirm() {
  local prompt="${1:-Continue?} [y/N] "
  read -r -p "$prompt" answer
  [[ "${answer,,}" == "y" || "${answer,,}" == "yes" ]]
}

echo ""
echo "  Kokuli Uninstaller"
echo ""

if ! confirm "This will remove Kokuli from your system. Continue?"; then
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
  for plist_name in com.kokuli.web com.verum.web; do
    local_plist="${HOME}/Library/LaunchAgents/${plist_name}.plist"
    if [[ -f "${local_plist}" ]]; then
      info "Unloading and removing launchd plist ${plist_name}..."
      launchctl unload "${local_plist}" 2>/dev/null || true
      rm -f "${local_plist}"
      info "launchd plist removed: ${plist_name}"
    fi
  done
fi

# ---------- remove symlink ----------

for link in "${SYMLINK_PATH}" "${LEGACY_SYMLINK}"; do
  if [[ -L "${link}" ]]; then
    info "Removing symlink at ${link}..."
    if [[ -w "$(dirname "${link}")" ]]; then
      rm -f "${link}"
    else
      sudo rm -f "${link}"
    fi
    info "Symlink removed: ${link}"
  fi
done

# ---------- remove install directory ----------

for dir in "${KRAUM_HOME}" "${LEGACY_HOME}"; do
  if [[ -d "${dir}" ]]; then
    info "Removing ${dir}..."
    rm -rf "${dir}"
    info "Installation directory removed: ${dir}"
  fi
done

if [[ ! -d "${KRAUM_HOME}" && ! -d "${LEGACY_HOME}" ]]; then
  warn "No installation found at ${KRAUM_HOME} or ${LEGACY_HOME}"
fi

echo ""
info "Kokuli has been uninstalled."
echo ""
