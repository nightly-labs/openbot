#!/bin/sh
# launchd runs this inside the current tenant's Aqua session. The root-owned helper's
# --relaunch path retains this UID, checks this UID's processes, and verifies the release.
set -eu
exec '/Library/Application Support/OpenBot/HostManager/host-manager' --relaunch
