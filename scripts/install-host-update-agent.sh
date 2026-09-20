#!/bin/sh
# Installs the host-managed update plumbing on a shared Mac.
#
# Usage (as an administrator):
#   sudo scripts/install-host-update-agent.sh [--managed] <tenant-user>...
#
# What it does:
#   1. Creates /Users/Shared/OpenBot/updates, writable by every tenant (sticky bit kept,
#      so tenants cannot delete each other's coordination files).
#   2. Installs the relaunch wrapper to /Library/Application Support/OpenBot/.
#   3. Seeds an empty release.json so per-user agents load (WatchPaths needs the file).
#   4. With --managed, drops the host-managed marker: tenants report update status but
#      never install on their own.
#   5. Installs and loads the relaunch LaunchAgent for each named tenant user.
#
# Tenants must already exist as Standard users. Run this while they are logged in so the
# agents load now; otherwise they load at next login. Removing --managed (deleting the
# marker) returns tenants to self-serve updates.
set -eu

MANAGED=0
USERS=""

for arg in "$@"; do
  case "$arg" in
    --managed) MANAGED=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *) USERS="$USERS $arg" ;;
  esac
done

if [ -z "$USERS" ]; then
  echo "usage: sudo $0 [--managed] <tenant-user>..." >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "run as an administrator (sudo)." >&2
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ASSETS="$SCRIPT_DIR/../build/macos/host-updates"

SHARED_DIR="/Users/Shared/OpenBot/updates"
SUPPORT_DIR="/Library/Application Support/OpenBot"
MARKER="$SUPPORT_DIR/host-managed.json"
RELEASE="$SHARED_DIR/release.json"
AGENT_LABEL="app.openbot.desktop.relaunch"

mkdir -p "$SHARED_DIR"
chmod 1777 "$SHARED_DIR"
mkdir -p "$SUPPORT_DIR"

install -m 755 "$REPO_ASSETS/openbot-relaunch.sh" "$SUPPORT_DIR/openbot-relaunch.sh"

if [ ! -f "$RELEASE" ]; then
  printf '{"version":"0.0.0","releasedAt":0,"wave":1}\n' > "$RELEASE"
  chmod 644 "$RELEASE"
fi

if [ "$MANAGED" -eq 1 ]; then
  printf '{"managed":true}\n' > "$MARKER"
  chmod 644 "$MARKER"
  echo "host-managed marker installed: tenants will not install on their own."
fi

for user in $USERS; do
  if ! id "$user" >/dev/null 2>&1; then
    echo "unknown user: $user (skipped)." >&2
    continue
  fi
  home=$(eval echo "~$user")
  agent_dir="$home/Library/LaunchAgents"
  mkdir -p "$agent_dir"
  install -m 644 "$REPO_ASSETS/$AGENT_LABEL.plist" "$agent_dir/$AGENT_LABEL.plist"
  chown "$user" "$agent_dir/$AGENT_LABEL.plist"
  uid=$(id -u "$user")
  if launchctl bootstrap "gui/$uid" "$agent_dir/$AGENT_LABEL.plist" 2>/dev/null; then
    echo "relaunch agent loaded for $user."
  else
    echo "relaunch agent installed for $user; it loads at next login."
  fi
done

echo "verification:"
echo -n "  shared dir: "
ls -ld "$SHARED_DIR"
for user in $USERS; do
  if id "$user" >/dev/null 2>&1; then
    uid=$(id -u "$user")
    echo -n "  agent for $user: "
    if sudo -u "$user" launchctl print "gui/$uid/$AGENT_LABEL" >/dev/null 2>&1; then
      echo "loaded."
    else
      echo "installed, not loaded (loads at next login)."
    fi
  fi
done
