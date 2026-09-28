#!/bin/sh
# Start the packaged Linux host when the machine has no desktop.
# Electron still needs a display. This script supplies Xvfb when neither DISPLAY nor
# WAYLAND_DISPLAY is set. It does not pass Chromium's --headless switch.
set -eu

app="${OPENBOT_APPIMAGE:-}"
if [ -z "$app" ] || [ ! -x "$app" ]; then
  echo "Set OPENBOT_APPIMAGE to an executable OpenBot AppImage." >&2
  exit 1
fi

export OPENBOT_HEADLESS="${OPENBOT_HEADLESS:-1}"

if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
  exec "$app"
fi

if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "No display is set and xvfb-run is not installed. Install the xvfb package." >&2
  exit 1
fi

screen="-screen 0 1280x800x24"
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && command -v dbus-run-session >/dev/null 2>&1; then
  exec dbus-run-session -- xvfb-run -a -s "$screen" "$app"
fi

exec xvfb-run -a -s "$screen" "$app"
