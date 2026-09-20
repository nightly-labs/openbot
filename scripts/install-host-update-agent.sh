#!/bin/sh
# Administrator setup. Build the standalone helper as an unprivileged developer first:
# bun build scripts/host-manager.ts --compile --outfile /tmp/openbot-host-manager
# sudo scripts/install-host-update-agent.sh --managed /tmp/openbot-host-manager client-acme client-bravo
set -eu
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
if [ "$(id -u)" -ne 0 ] || [ "${1:-}" != --managed ] || [ "$#" -lt 3 ]; then
  echo "usage: sudo $0 --managed <compiled-helper> <standard-user>..." >&2
  exit 1
fi
shift
HELPER=$1
shift
ASSETS=$(cd "$(dirname "$0")/../build/macos/host-updates" && pwd)
ROOT='/Library/Application Support/OpenBot/HostManager'

check_dir() {
  [ ! -L "$1" ] && [ -d "$1" ] && [ "$(stat -f %u "$1")" = 0 ] || exit 1
  mode=$(stat -f %Lp "$1")
  [ "$((0$mode & 0022))" -eq 0 ] || { echo "Remove group/public write access from $1 first." >&2; exit 1; }
  if ls -lde "$1" | grep -Eq '[0-9]+:.*allow.*(write|append|add_file|add_subdirectory|delete|chown)'; then
    echo "Remove writable ACLs from $1 first." >&2
    exit 1
  fi
}
for path in / /Library '/Library/Application Support' /Library/LaunchAgents /Library/LaunchDaemons; do check_dir "$path"; done
for path in '/Library/Application Support/OpenBot' "$ROOT"; do
  if [ ! -e "$path" ] && [ ! -L "$path" ]; then mkdir -m 755 "$path"; fi
  check_dir "$path"
done
if [ -e "$ROOT/config.json" ] || [ -L "$ROOT/config.json" ]; then
  echo 'Host Manager is already configured. Stop its system job before changing registration.' >&2
  exit 1
fi
UIDS=''
for tenant in "$@"; do
  case "$tenant" in ''|-*|*[!a-zA-Z0-9_-]*) echo 'Invalid tenant account name.' >&2; exit 1;; esac
  tenant_uid=$(id -u "$tenant")
  [ "$tenant_uid" -ge 501 ] || exit 1
  membership=$(dseditgroup -o checkmember -m "$tenant" admin)
  if printf '%s\n' "$membership" | grep -q '^yes'; then
    echo "Tenant $tenant must be a Standard user." >&2
    exit 1
  fi
  # Metadata only. Never open, scan, copy or modify any tenant content.
  tenant_home="/Users/$tenant"
  [ "$(dscl . -read "/Users/$tenant" NFSHomeDirectory)" = "NFSHomeDirectory: $tenant_home" ] || exit 1
  [ ! -L "$tenant_home" ] && [ -d "$tenant_home" ] && [ "$(stat -f %u "$tenant_home")" = "$tenant_uid" ] || exit 1
  home_mode=$(stat -f %Lp "$tenant_home")
  [ "$((0$home_mode & 0077))" -eq 0 ] || { echo "Set a private 0700 home for $tenant before enrollment." >&2; exit 1; }
  if ls -lde "$tenant_home" | grep -Eq '[0-9]+:.*allow'; then
    echo "Remove access-granting home ACLs for $tenant before enrollment." >&2
    exit 1
  fi
  UIDS="$UIDS $tenant_uid"
done
# The operator supplies trusted compiled code. Never compile repository hooks as root.
[ -f "$HELPER" ] && [ ! -L "$HELPER" ] || exit 1
for destination in "$ROOT/host-manager" "$ROOT/openbot-relaunch.sh" /Library/LaunchAgents/app.openbot.desktop.relaunch.plist /Library/LaunchDaemons/app.openbot.host-manager.plist; do
  [ ! -e "$destination" ] && [ ! -L "$destination" ] || { echo "Existing installation asset: $destination" >&2; exit 1; }
done
install -o root -g wheel -m 755 "$HELPER" "$ROOT/host-manager"
install -o root -g wheel -m 755 "$ASSETS/openbot-relaunch.sh" "$ROOT/openbot-relaunch.sh"
# UIDS contains only numbers returned by id above.
# shellcheck disable=SC2086
"$ROOT/host-manager" --setup $UIDS
install -o root -g wheel -m 644 "$ASSETS/app.openbot.desktop.relaunch.plist" /Library/LaunchAgents/app.openbot.desktop.relaunch.plist
install -o root -g wheel -m 644 "$ASSETS/app.openbot.host-manager.plist" /Library/LaunchDaemons/app.openbot.host-manager.plist
launchctl bootstrap system /Library/LaunchDaemons/app.openbot.host-manager.plist
for tenant in "$@"; do
  tenant_uid=$(id -u "$tenant")
  if ! launchctl bootstrap "gui/$tenant_uid" /Library/LaunchAgents/app.openbot.desktop.relaunch.plist; then
    echo "LaunchAgent for $tenant will load at the next GUI login."
  fi
done
ls -ld /Applications/OpenBot.app "$ROOT"
