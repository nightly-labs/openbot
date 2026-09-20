#!/bin/sh
# Per-tenant relaunch wrapper for host-managed OpenBot updates.
# Runs as a per-user LaunchAgent triggered by release.json, i.e. inside the tenant's own
# GUI session, so `open` attaches to the correct Aqua session.
#
# Relaunches only when OpenBot is not already running for this user and the installed
# bundle reached the released version. Exits quietly otherwise.
set -u

APP="/Applications/OpenBot.app"
RELEASE="/Users/Shared/OpenBot/updates/release.json"

# Already running here: nothing to do.
if pgrep -x OpenBot >/dev/null 2>&1; then
  exit 0
fi

# No release marker yet (first install still pending): stay out of the way.
if [ ! -f "$RELEASE" ]; then
  exit 0
fi

INSTALLED=""
if [ -f "$APP/Contents/Info.plist" ]; then
  INSTALLED=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP/Contents/Info.plist" 2>/dev/null || true)
fi
WANTED=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$RELEASE" | head -n 1)

# Launch only into the released build, never into a stale bundle.
if [ -n "$WANTED" ] && [ "$INSTALLED" != "$WANTED" ]; then
  exit 0
fi

open -a "$APP"
