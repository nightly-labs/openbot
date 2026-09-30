#!/bin/bash
# Installs OpenBot in a boat builder sandbox, so the sandbox can be saved as the hosted server
# template. `build-boat-template.ts` uploads this directory to the builder and runs:
#
#   sudo bash provision.sh <service-user> <appimage-url> <appimage-sha256> <auth-api-url>
#
# It enables openbot.service and the update units and never starts them. The builder then has no
# host identity and no account session, so every server made from the template starts empty and
# redeems its own claim. To upgrade a server in place, stop openbot.service, run the same command,
# and start the service again. After that, openbot-hosted-update keeps the server on the newest release.
set -euo pipefail

if [ "$(id -u)" -ne 0 ] || [ "$#" -ne 4 ]; then
  echo "usage: sudo bash $0 <service-user> <appimage-url> <appimage-sha256> <auth-api-url>" >&2
  exit 1
fi
SERVICE_USER=$1
APPIMAGE_URL=$2
APPIMAGE_SHA256=$3
AUTH_API_URL=$4
SOURCE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=openbot-hosted-update
source "$SOURCE/openbot-hosted-update"

[[ $SERVICE_USER =~ ^[a-z_][a-z0-9_-]*$ ]] && id "$SERVICE_USER" >/dev/null || fail "Unknown service user."
[[ $APPIMAGE_URL == https://* ]] || fail "The AppImage URL must use HTTPS."
[[ $APPIMAGE_SHA256 =~ ^[0-9a-f]{64}$ ]] || fail "The AppImage SHA-256 must be 64 hex digits."
[[ $AUTH_API_URL =~ ^https://[^/?#[:space:]]+/?$ ]] || fail "The account server URL must be an HTTPS origin."

# An update that runs now would move another release into place.
exec 9>"$LOCK"
flock 9
install_packages "$SOURCE/packages.txt"
# Compressed swap in memory: it uses no disk and no snapshot space, and it gives a small server time
# before the OOM killer acts. A kernel with no zram module, or an image with no package for it, gets
# none.
if modprobe zram 2>/dev/null && apt-get -o DPkg::Lock::Timeout=600 update &&
  apt-get -o DPkg::Lock::Timeout=600 install -y --no-install-recommends systemd-zram-generator; then
  printf '[zram0]\nzram-size = ram / 2\n' >/etc/systemd/zram-generator.conf
  chmod 0644 /etc/systemd/zram-generator.conf
else
  echo "zram is not available. The server has no compressed swap."
fi
apt-get clean
install -d -m 0755 "$INSTALL" "$INSTALL/hosted"
recover
work=$(mktemp -d "$SCRATCH/openbot-update.XXXXXX")
trap 'rm -rf "$work"' EXIT
fetch --output "$work/OpenBot.AppImage" "$APPIMAGE_URL"
echo "$APPIMAGE_SHA256  $work/OpenBot.AppImage" | sha256sum --check --quiet
unpack "$work/OpenBot.AppImage"
prepare_release "$work/squashfs-root"
# An older OpenBot cannot open a database that a newer one migrated.
installed=$(version_of "$INSTALL/app")
if [ -n "$installed" ] && newer "$installed" "$(version_of "$work/squashfs-root")"; then
  fail "OpenBot $installed is installed, and this AppImage has an older version."
fi
stage_release "$work/squashfs-root"
swap_in
printf '%s\n' "$SERVICE_USER" >"$INSTALL/hosted/service-user"
chmod 0644 "$INSTALL/hosted/service-user"
install_hosting "$SOURCE"
finish_swap

# The server keyring. boat keeps changes in /srv, and /srv is on the disk while /home is still on
# the restore mount after a resume. openbot-hosted-server explains why that matters.
install -d -o "$SERVICE_USER" -g "$(id -gn "$SERVICE_USER")" -m 0700 /srv/openbot-hosted
# Not a secret: the account server that this template's servers sign in to.
printf 'OPENBOT_AUTH_API_URL=%s\n' "${AUTH_API_URL%/}" >"$INSTALL/hosted/openbot.env"
chmod 0644 "$INSTALL/hosted/openbot.env"
