#!/bin/bash
# Installs OpenBot in a boat builder sandbox, so the sandbox can be saved as the hosted server
# template. `build-boat-template.ts` uploads this directory to the builder and runs:
#
#   sudo bash provision.sh <service-user> <appimage-url> <appimage-sha256> <auth-api-url>
#
# It enables openbot.service and never starts it. The builder then has no host identity and no
# account session, so every server made from the template starts empty and redeems its own claim.
set -euo pipefail
export LC_ALL=C DEBIAN_FRONTEND=noninteractive

if [ "$(id -u)" -ne 0 ] || [ "$#" -ne 4 ]; then
  echo "usage: sudo bash $0 <service-user> <appimage-url> <appimage-sha256> <auth-api-url>" >&2
  exit 1
fi
SERVICE_USER=$1
APPIMAGE_URL=$2
APPIMAGE_SHA256=$3
AUTH_API_URL=$4
SOURCE=$(cd "$(dirname "$0")" && pwd)
INSTALL=/opt/OpenBot

[[ $SERVICE_USER =~ ^[a-z_][a-z0-9_-]*$ ]] && id "$SERVICE_USER" >/dev/null || { echo "Unknown service user." >&2; exit 1; }
[[ $APPIMAGE_URL == https://* ]] || { echo "The AppImage URL must use HTTPS." >&2; exit 1; }
[[ $APPIMAGE_SHA256 =~ ^[0-9a-f]{64}$ ]] || { echo "The AppImage SHA-256 must be 64 hex digits." >&2; exit 1; }
[[ $AUTH_API_URL =~ ^https://[^/?#[:space:]]+/?$ ]] || { echo "The account server URL must be an HTTPS origin." >&2; exit 1; }

apt-get update
apt-get install -y --no-install-recommends \
  apparmor ca-certificates curl dbus dbus-x11 gnome-keyring libsecret-1-0 xauth xvfb \
  libasound2t64 libgbm1 libgtk-3-0t64 libnss3 libxss1
apt-get clean

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error --output "$work/OpenBot.AppImage" "$APPIMAGE_URL"
echo "$APPIMAGE_SHA256  $work/OpenBot.AppImage" | sha256sum --check --quiet
chmod 0755 "$work/OpenBot.AppImage"
# The unpacked build is the layout that the release verifier starts. It needs no FUSE, and a
# server keeps the version of its template: nothing here updates it in place.
(cd "$work" && ./OpenBot.AppImage --appimage-extract >/dev/null)
rm -rf "$INSTALL/app"
install -d -m 0755 "$INSTALL" "$INSTALL/hosted"
mv "$work/squashfs-root" "$INSTALL/app"
chown -R root:root "$INSTALL/app"
# The extract keeps the umask of this shell, which can be 077 under sudo. The service user must read
# and run every file, and must not write any of them.
chmod -R u+rwX,go=rX "$INSTALL/app"
[ -x "$INSTALL/app/openbot" ] || { echo "The AppImage has no openbot executable." >&2; exit 1; }

# The Electron sandbox stays on. It needs the SUID helper, owned as a package manager would own it,
# and an unprivileged user namespace, which Ubuntu 24.04 restricts through AppArmor. This is the
# same setup as the release verifier; `--no-sandbox` is never the answer.
chmod 4755 "$INSTALL/app/chrome-sandbox"
cat >/etc/apparmor.d/openbot-hosted <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>

profile openbot-hosted /opt/OpenBot/app/openbot flags=(unconfined) {
  userns,
}
PROFILE
chmod 0644 /etc/apparmor.d/openbot-hosted
if command -v apparmor_parser >/dev/null && [ -d /sys/kernel/security/apparmor ]; then
  apparmor_parser --replace /etc/apparmor.d/openbot-hosted
fi

install -m 0755 "$SOURCE/openbot-hosted-server" "$SOURCE/openbot-hosted-env" "$INSTALL/hosted/"
# The server keyring. boat keeps changes in /srv, and /srv is on the disk while /home is still on
# the restore mount after a resume. openbot-hosted-server explains why that matters.
install -d -o "$SERVICE_USER" -g "$(id -gn "$SERVICE_USER")" -m 0700 /srv/openbot-hosted
# Not a secret: the account server that this template's servers sign in to.
printf 'OPENBOT_AUTH_API_URL=%s\n' "${AUTH_API_URL%/}" >"$INSTALL/hosted/openbot.env"
chmod 0644 "$INSTALL/hosted/openbot.env"
sed "s/@SERVICE_USER@/$SERVICE_USER/g" "$SOURCE/openbot.service" >/etc/systemd/system/openbot.service
chmod 0644 /etc/systemd/system/openbot.service
systemctl daemon-reload
systemctl enable openbot.service
