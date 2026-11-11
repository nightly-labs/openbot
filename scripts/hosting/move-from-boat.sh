#!/bin/bash
# Moves the data of one hosted server from its boat sandbox to a VPS that an operator runs.
# docs/hosted-servers.md#move-a-server-from-boat has the full list of steps, the row change in the
# account service, and the rollback. This file does the parts that run on the machines, as root:
#
#   move-from-boat.sh prepare <hostname> <uid> <gid> <appimage-url> <appimage-sha256> <auth-api-url>
#       On the VPS, from a copy of scripts/hosting, while the customer still uses the sandbox. Makes
#       the service user with the IDs that it has in the sandbox (`id user` there), and installs
#       OpenBot with provision.sh. OpenBot stays disabled, so a restart of the VPS does not start it.
#
#   move-from-boat.sh export <archive>
#       On the sandbox. Stops OpenBot and keeps it stopped, then archives the home of the service user
#       and the server keyring. The archive holds the account session and each provider sign-in of
#       the customer: move it only over SSH, and delete each copy after the import.
#
#   move-from-boat.sh import <archive>
#       On the prepared VPS. Restores the archive and compares the checksums. It does not start
#       OpenBot. It names each command from npm and each group of the service user that the sandbox
#       had and this machine does not have.
#
#   move-from-boat.sh start
#       On the VPS, after a complete import, when the row of the server names this machine and the
#       sandbox is stopped. Enables and starts OpenBot.
#
#   move-from-boat.sh discard <hostname>
#       On the VPS, for an import that failed or that must not start. Removes the restored data, so
#       that `import` can run again. It refuses after `start`: a server that ran here has data that
#       no other machine has, and only a reinstall of the machine erases it.
#
# A second run of `export` makes the same archive again. `import` refuses a machine that already
# has the data of a server.
set -euo pipefail
export LC_ALL=C
umask 077

SERVICE_USER=user
USER_HOME=/home/$SERVICE_USER
KEYRING_HOME=/srv/openbot-hosted
MANIFEST=$KEYRING_HOME/move-manifest
# On the VPS, from the start of an import until `start`: `importing`, or `imported` and the checksum
# of the restored database. While it is there, OpenBot did not run on the restored data.
IMPORT_STATE=/var/lib/openbot-move-import
DATABASE=$USER_HOME/.config/OpenBot/openbot.db
# The files that must be the same on the two machines. The agent database is there only after an
# agent made a table.
CHECKED=(
  "$DATABASE"
  "$USER_HOME/OpenBot/Shared/Data/agent-data.db"
  "$USER_HOME/.config/openbot-hosted/keyring-password"
  "$KEYRING_HOME/keyrings/login.keyring"
)
# The files of boat, the X authorization of the old displays, and a cache that npm makes again.
# The installed release in /opt/OpenBot is not in the archive: provision.sh installs it.
EXCLUDED=(
  "--exclude=./home/$SERVICE_USER/.boat"
  "--exclude=./home/$SERVICE_USER/.boatignore"
  "--exclude=./home/$SERVICE_USER/.Xauthority*"
  "--exclude=./home/$SERVICE_USER/.npm/_cacache"
)

fail() {
  echo "$*" >&2
  exit 1
}

# One line for each file of CHECKED that exists: its SHA-256 and its path.
checksums() {
  local file
  for file in "${CHECKED[@]}"; do
    if [ -f "$file" ]; then sha256sum "$file"; fi
  done
}

openbot_runs() {
  systemctl is-active --quiet openbot.service || pgrep -u "$SERVICE_USER" -x openbot >/dev/null
}

installed_version() {
  sed -n 's/^X-AppImage-Version=//p' /opt/OpenBot/app/*.desktop 2>/dev/null | head -n 1
}

is_hosted_install() {
  [ "$(cat /opt/OpenBot/hosted/service-user 2>/dev/null)" = "$SERVICE_USER" ] && [ ! -e /opt/OpenBot/hosted/mode ]
}

# One line for each command that npm installed for all users: its name, its package and its
# version. The image of a boat sandbox has agent commands of this type, such as `claude` and `codex`,
# and the image of a VPS has none.
system_clis() {
  local modules=/usr/local/lib/node_modules link target package version
  for link in /usr/local/bin/*; do
    [ -L "$link" ] || continue
    target=$(readlink -f "$link") || continue
    case $target in "$modules"/*) ;; *) continue ;; esac
    package=${target#"$modules"/}
    case $package in
      @*) package=$(cut -d/ -f1-2 <<<"$package") ;;
      *) package=${package%%/*} ;;
    esac
    case $package in npm | corepack) continue ;; esac
    version=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$modules/$package/package.json" 2>/dev/null | head -n 1)
    printf '%s %s %s\n' "${link##*/}" "$package" "${version:-unknown}"
  done
}

# The groups of the service user, without its own group. One line for each.
extra_groups() {
  id -Gn "$SERVICE_USER" | tr ' ' '\n' | grep -vxF "$(id -gn "$SERVICE_USER")" || true
}

# Empty when the machine has no import state.
import_state() {
  sed -n '1p' "$IMPORT_STATE" 2>/dev/null || true
}

# True when OpenBot is neither enabled nor running, which is the state after `prepare`.
openbot_is_off() {
  ! systemctl is-enabled --quiet openbot.service 2>/dev/null && ! openbot_runs
}

# True when the restored database is the file that `import` checked.
database_is_unchanged() {
  local sum
  sum=$(sed -n 's/^database=//p' "$IMPORT_STATE")
  [ -n "$sum" ] && [ -f "$DATABASE" ] && [ "$(sha256sum "$DATABASE" | cut -d' ' -f1)" = "$sum" ]
}

prepare() {
  [ "$#" -eq 6 ] ||
    fail "usage: $0 prepare <hostname> <uid> <gid> <appimage-url> <appimage-sha256> <auth-api-url>"
  local hostname=$1 uid=$2 gid=$3 appimage_url=$4 appimage_sha256=$5 auth_api_url=$6 source owner copy
  [[ $hostname =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || fail "The hostname is not valid."
  [[ $uid =~ ^[1-9][0-9]*$ ]] && [[ $gid =~ ^[1-9][0-9]*$ ]] ||
    fail "The user and group IDs must be numbers above 0."
  source=$(cd "$(dirname "$0")" && pwd)
  [ -f "$source/provision.sh" ] || fail "Run this file from a copy of scripts/hosting."
  [ ! -e /opt/OpenBot ] || fail "OpenBot is installed on this machine. Use a free pool server."
  [ ! -e "$USER_HOME" ] && [ ! -e "$KEYRING_HOME" ] ||
    fail "This machine has data in $USER_HOME or $KEYRING_HOME."
  ! id "$SERVICE_USER" >/dev/null 2>&1 || fail "This machine has a user $SERVICE_USER."
  owner=$(getent passwd "$uid" | cut -d: -f1 || true)
  [ -z "$owner" ] || fail "The user $owner has the ID $uid on this machine. Remove that user, then run this again."
  owner=$(getent group "$gid" | cut -d: -f1 || true)
  [ -z "$owner" ] || fail "The group $owner has the ID $gid on this machine. Remove that group, then run this again."

  # Before OpenBot starts: the X authorization of its displays has the hostname in it.
  hostnamectl set-hostname "$hostname"
  groupadd --gid "$gid" "$SERVICE_USER"
  # Agents run shell commands as this user, so it gets a login shell, and no password.
  useradd --uid "$uid" --gid "$gid" --create-home --home-dir "$USER_HOME" --shell /bin/bash "$SERVICE_USER"
  # provision.sh installs two files as the service user, who cannot read a directory in the home of
  # root. So it runs from a copy that each user can read. The files have no secret.
  copy=$(mktemp -d /run/openbot-move.XXXXXX)
  # shellcheck disable=SC2064 # The path is known now.
  trap "rm -rf '$copy'" EXIT
  cp -R "$source/." "$copy/"
  chmod -R u=rwX,go=rX "$copy"
  # Installs and enables OpenBot, and does not start it.
  bash "$copy/provision.sh" "$SERVICE_USER" "$appimage_url" "$appimage_sha256" "$auth_api_url"
  is_hosted_install || fail "The install is not a hosted server of the user $SERVICE_USER."
  # The row of the server does not name this machine yet, so no restart must start OpenBot.
  systemctl disable --quiet openbot.service
  if openbot_runs; then fail "OpenBot runs. Stop it."; fi
  echo "Installed OpenBot $(installed_version) on $hostname for the user $SERVICE_USER ($uid:$gid). It is disabled."
  echo "Next: run leaseweb-bootstrap.sh, restart this machine one time, and then export the sandbox."
}

export_data() {
  [ "$#" -eq 1 ] || fail "usage: $0 export <archive>"
  local archive=$1 version
  [ ! -e "$archive" ] || fail "$archive exists. Give a new path."
  id "$SERVICE_USER" >/dev/null 2>&1 || fail "This machine has no user $SERVICE_USER. It is not a boat sandbox."
  is_hosted_install || fail "This machine is not a hosted server of the user $SERVICE_USER."
  [ -s "$USER_HOME/.config/OpenBot/openbot.db" ] || fail "The home of $SERVICE_USER has no OpenBot database."
  [ -s "$USER_HOME/.config/openbot-hosted/keyring-password" ] && [ -s "$KEYRING_HOME/keyrings/login.keyring" ] ||
    fail "The server keyring or its password file is missing. The server could not sign in after the move."
  # While boat restores the disk, a directory can show no files.
  if [ -e /var/lib/ascii-lazy/active ] && [ ! -e /var/lib/ascii-lazy/hydration-done ]; then
    fail "boat still restores the disk of this sandbox. Try again in some minutes."
  fi
  version=$(installed_version)
  [ -n "$version" ] || fail "The version of the installed OpenBot is not known."

  # The same order as openbot-boat-pre-stop: the marker first, so that nothing starts OpenBot again.
  touch /run/openbot-pre-stop
  systemctl stop openbot.service
  if openbot_runs; then fail "OpenBot still runs. Nothing was archived."; fi

  {
    printf 'uid=%s\ngid=%s\nversion=%s\n' "$(id -u "$SERVICE_USER")" "$(id -g "$SERVICE_USER")" "$version"
    checksums | sed 's/^/sha256=/'
    system_clis | sed 's/^/cli=/'
    extra_groups | sed 's/^/group=/'
  } >"$MANIFEST"
  chmod 0600 "$MANIFEST"

  # The manifest is the first member, so `import` reads it before it restores a file.
  # tar also fails when a process outside openbot.service changes a file while tar reads it.
  if ! tar --create --file "$archive" --numeric-owner --acls --xattrs --one-file-system --anchored --directory / \
    "${EXCLUDED[@]}" "./${MANIFEST#/}" "./${USER_HOME#/}" "./${KEYRING_HOME#/}"; then
    rm -f "$MANIFEST"
    fail "The archive is not complete. OpenBot stays stopped. Delete $archive and run the export again."
  fi
  rm -f "$MANIFEST"
  if openbot_runs; then fail "OpenBot started during the archive. Delete $archive and run the export again."; fi
  echo "Archived OpenBot $version to $archive ($(du -h "$archive" | cut -f1))."
  echo "OpenBot stays stopped until this sandbox stops. Do not start it here after the VPS runs."
}

import_data() {
  [ "$#" -eq 1 ] && [ -f "$1" ] || fail "usage: $0 import <archive>"
  local archive=$1 manifest version installed sums clis groups missing line
  is_hosted_install || fail "This machine is not prepared. Run \"$0 prepare\" first."
  openbot_is_off || fail "OpenBot is enabled or runs on this machine. It is not a prepared pool server."
  [ ! -e "$IMPORT_STATE" ] ||
    fail "An import did not get to its start on this machine. Run \"$0 discard $(hostname)\", then run the import again."
  [ ! -e "$USER_HOME/.config/OpenBot" ] && [ ! -e "$KEYRING_HOME/keyrings" ] ||
    fail "This machine has the data of a server."

  # Only the manifest, to standard output: no file of the archive is on the disk yet.
  manifest=$(tar --extract --file "$archive" --to-stdout --occurrence=1 "./${MANIFEST#/}") || fail "The archive has no manifest."
  version=$(sed -n 's/^version=//p' <<<"$manifest")
  sums=$(sed -n 's/^sha256=//p' <<<"$manifest")
  [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && [ -n "$sums" ] || fail "The manifest has no version or no checksum."
  [ "$(sed -n 's/^uid=//p' <<<"$manifest"):$(sed -n 's/^gid=//p' <<<"$manifest")" = "$(id -u "$SERVICE_USER"):$(id -g "$SERVICE_USER")" ] ||
    fail "The user $SERVICE_USER has other IDs here than in the sandbox."
  # An older OpenBot cannot open a database that a newer one migrated.
  installed=$(installed_version)
  if [ "$installed" != "$version" ] &&
    [ "$(printf '%s\n%s\n' "$installed" "$version" | sort -V | tail -n 1)" = "$version" ]; then
    fail "This machine has OpenBot ${installed:-of no known version}, and the sandbox had $version. Install $version or newer."
  fi

  # From here, only `discard` makes a second import possible.
  echo importing >"$IMPORT_STATE"
  # The archive is from a machine where an agent of the customer can get root, and the service user
  # has no root here. So the service user restores it, and only its two directories: the kernel
  # then refuses a file outside them, an owner that is not the service user, a device, a hard link
  # to a file of root, and a file capability. A file that root or another user owned in the sandbox
  # gets the service user as its owner.
  runuser -u "$SERVICE_USER" -- tar --extract --file - --no-same-owner --same-permissions --acls --xattrs \
    --xattrs-include='user.*' --directory / "./${USER_HOME#/}" "./${KEYRING_HOME#/}" <"$archive" ||
    fail "The archive was not restored. Run \"$0 discard $(hostname)\", then run the import again."
  rm -f "$MANIFEST"
  sha256sum --check --quiet <<<"$sums" ||
    fail "A restored file is not the file of the sandbox. Do not start OpenBot. Run \"$0 discard $(hostname)\"."
  if openbot_runs; then fail "OpenBot runs, and the import is not complete. Stop it."; fi
  printf 'imported\ndatabase=%s\n' "$(sha256sum "$DATABASE" | cut -d' ' -f1)" >"$IMPORT_STATE"
  echo "Restored the server of OpenBot $version. This machine has OpenBot $installed, and it does not run."
  echo "Next: when the row of the server names this machine and the sandbox is stopped, run: $0 start"
  echo "Delete $archive on each machine that has a copy."

  # The manifest is text from the other machine: print only lines of the known shape.
  clis=$(sed -n 's/^cli=//p' <<<"$manifest" | grep -E '^[A-Za-z0-9._-]+ [@A-Za-z0-9._/-]+ [A-Za-z0-9.+-]+$' || true)
  missing=""
  while read -r line; do
    [ -n "$line" ] || continue
    runuser -u "$SERVICE_USER" -- bash -lc "command -v -- '${line%% *}'" </dev/null >/dev/null 2>&1 ||
      missing+="  ${line%% *} (${line#* })"$'\n'
  done <<<"$clis"
  if [ -n "$missing" ]; then
    printf 'The sandbox had these commands from npm, and this machine does not have them:\n%s' "$missing"
    echo "A provider whose CLI is in the list has no CLI here: OpenBot tells the user to download it. The provider sign-in stays."
  fi
  groups=$(sed -n 's/^group=//p' <<<"$manifest" | grep -E '^[a-z_][a-z0-9_-]*$' || true)
  missing=""
  while read -r line; do
    [ -n "$line" ] || continue
    id -Gn "$SERVICE_USER" | tr ' ' '\n' | grep -qxF "$line" || missing+=" $line"
  done <<<"$groups"
  if [ -n "$missing" ]; then
    echo "The user $SERVICE_USER was in these groups in the sandbox, and is not in them here:$missing"
  fi
}

start() {
  [ "$#" -eq 0 ] || fail "usage: $0 start"
  is_hosted_install || fail "This machine is not prepared. Run \"$0 prepare\" first."
  [ "$(import_state)" = imported ] ||
    fail "This machine has no complete import that waits for its start."
  openbot_is_off || fail "OpenBot is enabled or runs on this machine."
  database_is_unchanged || fail "The database is not the file that the import checked. Do not start OpenBot."
  # First: from here OpenBot can change the data, so `discard` must refuse.
  rm -f "$IMPORT_STATE"
  systemctl enable --now openbot.service
  echo "OpenBot $(installed_version) is enabled and started. The host is online when its first sign-in ends."
}

discard() {
  [ "$#" -eq 1 ] || fail "usage: $0 discard <hostname of this machine>"
  local state mode
  [ "$1" = "$(hostname)" ] || fail "This machine is $(hostname), not $1. Nothing was removed."
  is_hosted_install || fail "This machine is not prepared. Nothing was removed."
  state=$(import_state)
  [ "$state" = importing ] || [ "$state" = imported ] ||
    fail "This machine has no import that waits for its start. To erase a server that ran here, reinstall the machine."
  openbot_is_off || fail "OpenBot is enabled or runs on this machine. Nothing was removed."
  if [ "$state" = imported ] && ! database_is_unchanged; then
    fail "The database changed after the import. Nothing was removed. To erase this server, reinstall the machine."
  fi
  # Not across a mount, and a link is removed, not followed.
  find "$USER_HOME" "$KEYRING_HOME" -xdev -mindepth 1 -delete
  # The copy also gives the home the mode of /etc/skel, so set the mode of a new home again.
  cp -a /etc/skel/. "$USER_HOME/"
  chown -R "$SERVICE_USER:$(id -gn "$SERVICE_USER")" "$USER_HOME"
  mode=$(sed -n 's/^HOME_MODE[[:space:]]*//p' /etc/login.defs | head -n 1)
  chmod "${mode:-0750}" "$USER_HOME"
  rm -f "$IMPORT_STATE"
  echo "Removed the restored data on $(hostname). The machine is prepared again: run the import."
}

[ "$(id -u)" -eq 0 ] || fail "Run this as root."
command=${1:-}
shift || true
case $command in
  prepare) prepare "$@" ;;
  export) export_data "$@" ;;
  import) import_data "$@" ;;
  start) start "$@" ;;
  discard) discard "$@" ;;
  *) fail "usage: $0 prepare|export|import|start|discard (the top of this file has the arguments)" ;;
esac
