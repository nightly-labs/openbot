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
#   move-from-boat.sh upgrade <appimage-url> <appimage-sha256> <auth-api-url>
#       On a prepared VPS that has no data of a server. A disabled OpenBot does not update, so this
#       installs a newer release with provision.sh, and OpenBot stays disabled.
#
#   move-from-boat.sh packages
#       On the sandbox, while the customer still uses it. Prints the apt packages that the customer
#       installed, for `install-packages`. It does not stop OpenBot.
#
#   move-from-boat.sh install-packages
#       On the prepared VPS, before the export. Installs the apt packages that `packages` printed, from
#       standard input, so that the import does not install them during the downtime.
#
#   move-from-boat.sh export <archive | ->
#       On the sandbox. Stops OpenBot and keeps it stopped, then archives the home of the service user,
#       the server keyring, and what the customer installed outside the home: directories in /opt and
#       /usr/local, npm packages for all users, programs in /usr/local/bin, the crontab, and the names
#       of the apt packages. It also archives each agent CLI of the image that the customer signed in
#       to. It does not archive what the boat image has. The archive holds the account session, each
#       provider sign-in and each key of the customer: move it only over SSH, and delete each copy
#       after the import. With `-`, the archive goes to standard output and the messages to standard
#       error: send it to the VPS through SSH, so that the sandbox needs no disk space for a copy.
#
#   move-from-boat.sh import <archive>
#       On the prepared VPS. Restores the archive as the service user and compares the checksums. Puts
#       the moved commands in ~/.local/bin, installs the crontab and the apt packages, and names each
#       command that cannot start here and each item that the move did not copy. It does not start
#       OpenBot.
#
#   move-from-boat.sh start
#       On the VPS, after a complete import, when the row of the server names this machine and the
#       sandbox is stopped. Enables and starts OpenBot.
#
#   move-from-boat.sh discard <hostname>
#       On the VPS, for an import that failed or that must not start. Removes the restored data, the
#       restored directories and the crontab, so that `import` can run again. The apt packages stay. It refuses after `start`: a server that ran here has data that
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
# The customer can install software outside the home: the service user owns /usr/local and /opt in
# the sandbox and can use sudo. The move copies what the customer added there, and not what the
# boat image has. These are the contents of the images in BASE_IMAGES (the value of
# ~/.base-image-version), from new sandboxes on 2026-11-12, and what provision.sh adds.
# A newer image can add more: the export then copies it too, and names each tree with its size.
BASE_IMAGES=" c4ed68db-513f-4b6d-a61a-64b99b0c2a2c 5f37c910-7706-423d-b524-5c66b09885d2 "
BASE_OPT=" actions-runner ascii ascii-agent ascii-baremetal-setup cmake-3.31.3-linux-x86_64 containerd google
  gradle-8.12 kimi-code kotlinc moonlight-web OpenBot prime-agent sbt scala3 scala3-3.3.8 scrcpy-linux-x86_64-v3.1 "
BASE_LOCAL=" bin cargo etc games go include lib lib64 libexec man rustup sbin share src "
BASE_LIB=" ascii ascii-harnesses node_modules pkgconfig python3.12 R ruby "
BASE_NPM=" @anthropic-ai/claude-code @earendil-works/pi-coding-agent @openai/codex corepack npm pnpm "
BASE_BIN=" agent ariana-fswatch ascii-binderfs-add ascii-desktop ascii-desktop-session ascii-proclog
  ascii-record-desktop ascii-setup-binder-devices boat box bun bundle bundler bunx cargo cargo-clippy cargo-fmt
  claude clippy-driver cmake codex composer cpack ctest cua-driver cursor-agent deno erb gem go gofmt gradle
  hermes hermes-acp hermes-agent irb kimi kotlin kotlinc minitest node npm npx openbot openclaw opencode pi
  pnpm pnpx poetry prime-agent racc rake rbs rdbg rdoc ri ruby rust-analyzer rustc rustfmt rustup sbt scala
  scalac scaladoc scrcpy scrcpy-server start-agents-server stop-agents-server sync-docker-firewall
  syntax_suggest test-unit typeprof uv vibe vibe-acp "
# The image installs these apt packages by hand, but ~/.base-apt-packages.txt does not have them.
BASE_APT=" gir1.2-javascriptcoregtk-4.1 gir1.2-webkit2-4.1 libatk1.0-dev libbz2-dev libcairo2-dev libegl1
  libffi-dev libfuse2t64 libgbm1 libgdk-pixbuf-2.0-0 libgdk-pixbuf2.0-dev libgl1-mesa-dri libgles2
  libglib2.0-0t64 libglib2.0-dev libgtk-3-0t64 libgtk-3-dev libjavascriptcoregtk-4.1-dev liblzma-dev
  libncurses-dev libpam-systemd libpango1.0-dev libreadline-dev librsvg2-dev libsdl2-2.0-0 libsoup-3.0-dev
  libsqlite3-dev libssl-dev libusb-1.0-0 libwebkit2gtk-4.1-0 libxml2-dev libyaml-dev openjdk-11-jdk
  pkg-config tk-dev zlib1g-dev "
# The agent CLIs of the image, each with the file that its sign-in makes in the home. The move copies
# such a CLI when the customer signed in to it: a VPS has no agent CLI, and OpenBot would ask the
# customer to download it again.
IMAGE_CLIS=(
  "@anthropic-ai/claude-code .claude/.credentials.json"
  "@openai/codex .codex/auth.json"
  "@earendil-works/pi-coding-agent .pi/agent/auth.json"
)
# Files in the server keyring directory that only carry data from `export` to `import`.
MOVED_BIN=$KEYRING_HOME/move-bin
MOVED_CRONTAB=$KEYRING_HOME/move-crontab

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

# True when the word is in the list: a string with a space before and after each word.
# A list can go on more than one line, so each space or line break separates two names.
listed() {
  [ -n "$1" ] && [[ " ${2//[[:space:]]/ } " == *" $1 "* ]]
}

# One part of a path, with no "/", no "." or "..", and no space.
plain_name() {
  [[ $1 =~ ^[A-Za-z0-9@_+][A-Za-z0-9@._+-]*$ ]]
}

# The names in /usr/local/lib that programs of root read: a library, a unit, a module, a rule or a
# configuration there runs as root. The service user must not own such a directory on the VPS.
root_reads_lib() {
  case $1 in
    *.d | systemd | udev | firmware | modules | kernel | security | pkcs11 | ssl | openssl* | sane | gio | \
      girepository-* | gtk-* | gdk-pixbuf-* | python* | perl* | site_perl | ruby | site_ruby | lua | ocaml | \
      node_modules | pkgconfig | cmake | lib* | ld* | *-linux-gnu* | *-linux-musl*) return 0 ;;
  esac
  return 1
}

# True for a directory that the import can give to the service user: one directory in /opt, in
# /usr/local or in /usr/local/lib, or one npm package for all users. No program of root reads it.
movable_tree() {
  local path=$1 rest
  case $path in
    /usr/local/lib/node_modules/@*/*)
      rest=${path#/usr/local/lib/node_modules/}
      [[ $rest =~ ^@[^/]+/[^/]+$ ]] && plain_name "${rest%%/*}" && plain_name "${rest#*/}"
      ;;
    /usr/local/lib/node_modules/*)
      rest=${path#/usr/local/lib/node_modules/}
      [[ $rest != @* ]] && plain_name "$rest"
      ;;
    /usr/local/lib/*)
      rest=${path#/usr/local/lib/}
      plain_name "$rest" && ! root_reads_lib "$rest"
      ;;
    /opt/*) plain_name "${path#/opt/}" ;;
    /usr/local/*)
      rest=${path#/usr/local/}
      plain_name "$rest" && ! listed "$rest" "$BASE_LOCAL"
      ;;
    *) return 1 ;;
  esac
}

# One line for each directory outside the home that the customer added: in /opt, in /usr/local, in
# /usr/local/lib, and each npm package for all users. Also each agent CLI of the image that the
# customer signed in to.
added_trees() {
  local path name entry
  for path in /opt/* /usr/local/* /usr/local/lib/*; do
    [ -d "$path" ] && [ ! -L "$path" ] || continue
    name=${path##*/}
    case ${path%/*} in
      /opt) listed "$name" "$BASE_OPT" && continue ;;
      /usr/local) listed "$name" "$BASE_LOCAL" && continue ;;
      /usr/local/lib) listed "$name" "$BASE_LIB" && continue ;;
    esac
    echo "$path"
  done
  for path in /usr/local/lib/node_modules/* /usr/local/lib/node_modules/@*/*; do
    [ -d "$path" ] && [ ! -L "$path" ] || continue
    name=${path#/usr/local/lib/node_modules/}
    case $name in @*/*) ;; @*) continue ;; esac
    listed "$name" "$BASE_NPM" && continue
    echo "$path"
  done
  for entry in "${IMAGE_CLIS[@]}"; do
    path=/usr/local/lib/node_modules/${entry%% *}
    if [ -d "$path" ] && [ -s "$USER_HOME/${entry#* }" ]; then echo "$path"; fi
  done
}

# The commands in /usr/local/bin that the move keeps, in ~/.local/bin on the VPS: `link=<name> <path>`
# for a link into a moved tree or into the home, and `file=<name>` for a program that the customer
# put there. $1 has one moved tree on each line.
added_commands() {
  local trees=$1 entry name target tree
  for entry in /usr/local/bin/*; do
    name=${entry##*/}
    plain_name "$name" || continue
    if [ -L "$entry" ]; then
      target=$(readlink -f "$entry") || continue
      case $target in "$USER_HOME"/*)
        echo "link=$name $target"
        continue
        ;;
      esac
      while read -r tree; do
        [ -n "$tree" ] || continue
        case $target in "$tree"/*)
          echo "link=$name $target"
          break
          ;;
        esac
      done <<<"$trees"
    elif [ -f "$entry" ] && ! listed "$name" "$BASE_BIN"; then
      echo "file=$name"
    fi
  done
}

# The commands of each moved npm package that the loop of added_commands did not give. The image
# has some of them, such as `pi`, as a shim that is not a link. $1 has one moved tree on each line,
# and $2 is the output of added_commands.
package_commands() {
  local trees=$1 given=$2 tree name path
  while read -r tree; do
    case $tree in /usr/local/lib/node_modules/*) ;; *) continue ;; esac
    while read -r name path; do
      plain_name "$name" || continue
      grep -q "^link=$name " <<<"$given" && continue
      path=$(realpath -e -- "$tree/$path" 2>/dev/null) || continue
      case $path in "$tree"/*) echo "link=$name $path" ;; esac
    done < <(python3 -c '
import json, sys
data = json.load(open(sys.argv[1]))
bins = data.get("bin")
if isinstance(bins, str):
    bins = {data.get("name", "").split("/")[-1]: bins}
for name, path in (bins or {}).items():
    if isinstance(name, str) and isinstance(path, str) and " " not in name + path:
        print(name, path)' "$tree/package.json" 2>/dev/null)
  done <<<"$trees"
}

# Each package that the customer installed with apt: installed by hand, and not in the list that the
# image keeps in the home or in BASE_APT.
added_packages() {
  local base=$USER_HOME/.base-apt-packages.txt
  [ -s "$base" ] || return 0
  local name
  comm -13 <(sort -u "$base") <(apt-mark showmanual | sed 's/:.*//' | sort -u) | while read -r name; do
    listed "$name" "$BASE_APT" || echo "$name"
  done
}

# What the move does not copy, for the report of the import.
not_moved() {
  local count
  if command -v docker >/dev/null; then
    count=$(timeout 20 docker ps --all --quiet 2>/dev/null | wc -l) || count=0
    [ "$count" -eq 0 ] || echo "$count docker containers"
    count=$(timeout 20 docker images --quiet 2>/dev/null | wc -l) || count=0
    [ "$count" -eq 0 ] || echo "$count docker images"
  fi
  count=$(find /usr/local/lib/python3*/dist-packages -mindepth 1 -maxdepth 1 2>/dev/null | wc -l)
  [ "$count" -eq 0 ] || echo "$count Python packages for all users"
  [ -s "$USER_HOME/.base-apt-packages.txt" ] || echo "the apt packages: the image has no list of its packages"
}

# The version of Ubuntu, such as 24.04.
os_version() {
  sed -n 's/^VERSION_ID="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' /etc/os-release 2>/dev/null | head -n 1
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

upgrade() {
  [ "$#" -eq 3 ] || fail "usage: $0 upgrade <appimage-url> <appimage-sha256> <auth-api-url>"
  local source copy
  source=$(cd "$(dirname "$0")" && pwd)
  [ -f "$source/provision.sh" ] || fail "Run this file from a copy of scripts/hosting."
  is_hosted_install || fail "This machine is not prepared. Run \"$0 prepare\" first."
  [ ! -e "$USER_HOME/.config/OpenBot" ] && [ ! -e "$KEYRING_HOME/keyrings" ] && [ ! -e "$IMPORT_STATE" ] ||
    fail "This machine has the data of a server. Do not upgrade it here."
  if openbot_runs; then fail "OpenBot runs. Stop it."; fi
  copy=$(mktemp -d /run/openbot-move.XXXXXX)
  # shellcheck disable=SC2064 # The path is known now.
  trap "rm -rf '$copy'" EXIT
  cp -R "$source/." "$copy/"
  chmod -R u=rwX,go=rX "$copy"
  bash "$copy/provision.sh" "$SERVICE_USER" "$1" "$2" "$3"
  systemctl disable --quiet openbot.service
  if openbot_runs; then fail "OpenBot runs. Stop it."; fi
  echo "Installed OpenBot $(installed_version). It is disabled."
}

# Prints the apt packages of the customer, as `install-packages` and the manifest read them.
packages() {
  [ "$#" -eq 0 ] || fail "usage: $0 packages"
  id "$SERVICE_USER" >/dev/null 2>&1 || fail "This machine has no user $SERVICE_USER. It is not a boat sandbox."
  [ -s "$USER_HOME/.base-apt-packages.txt" ] || echo "The image has no list of its apt packages. The move installs no apt package." >&2
  added_packages | sed 's/^/apt=/'
}

install_packages() {
  [ "$#" -eq 0 ] || fail "usage: $0 install-packages <list from \"$0 packages\""
  is_hosted_install || fail "This machine is not prepared. Run \"$0 prepare\" first."
  install_packages_of "$(cat)"
}

export_data() {
  [ "$#" -eq 1 ] || fail "usage: $0 export <archive | ->"
  local archive=$1 copy=$1 version
  if [ "$archive" = - ]; then
    [ ! -t 1 ] || fail "Send the archive through SSH to the VPS, not to the terminal."
    copy="the copy of the archive"
    # The archive goes to descriptor 3, and each message to standard error.
    exec 3>&1 1>&2
  else
    [ ! -e "$archive" ] || fail "$archive exists. Give a new path."
  fi
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

  local tree trees="" members=() commands name notes
  while read -r tree; do
    [ -n "$tree" ] || continue
    if movable_tree "$tree"; then
      trees+="$tree"$'\n'
      members+=("./${tree#/}")
    else
      notes+="$tree: programs of root read it"$'\n'
    fi
  done < <(added_trees | sort -u)
  commands=$(added_commands "$trees")
  commands+=$'\n'$(package_commands "$trees" "$commands")
  notes+=$(not_moved)

  rm -rf "$MOVED_BIN" "$MOVED_CRONTAB"
  # shellcheck disable=SC2064 # The paths are known now.
  trap "rm -rf '$MANIFEST' '$MOVED_BIN' '$MOVED_CRONTAB'" EXIT
  {
    printf 'uid=%s\ngid=%s\nversion=%s\nos=%s\n' "$(id -u "$SERVICE_USER")" "$(id -g "$SERVICE_USER")" "$version" "$(os_version)"
    checksums | sed 's/^/sha256=/'
    system_clis | sed 's/^/cli=/'
    extra_groups | sed 's/^/group=/'
    printf '%s' "$trees" | sed 's/^/tree=/'
    printf '%s\n' "$commands" | sed '/^$/d'
    added_packages | sed 's/^/apt=/'
    printf '%s\n' "$notes" | sed '/^$/d; s/^/skipped=/'
  } >"$MANIFEST"
  chmod 0600 "$MANIFEST"
  # The programs that the customer put in /usr/local/bin, and the crontab of the service user, go with
  # the server keyring. `import` moves them to their places as the service user.
  while read -r name; do
    [ -n "$name" ] || continue
    install -d -m 0700 "$MOVED_BIN"
    cp --preserve=mode,timestamps --dereference "/usr/local/bin/$name" "$MOVED_BIN/$name"
  done < <(sed -n 's/^file=//p' <<<"$commands")
  if [ -s "/var/spool/cron/crontabs/$SERVICE_USER" ]; then
    install -m 0600 "/var/spool/cron/crontabs/$SERVICE_USER" "$MOVED_CRONTAB"
  fi

  # The manifest is the first member, so `import` reads it before it restores a file.
  # tar also fails when a process outside openbot.service changes a file while tar reads it.
  local created=0
  if [ "$archive" = - ]; then
    tar --create --file - --numeric-owner --acls --xattrs --one-file-system --anchored --directory / \
      "${EXCLUDED[@]}" "./${MANIFEST#/}" "./${USER_HOME#/}" "./${KEYRING_HOME#/}" "${members[@]}" >&3 || created=$?
    exec 3>&-
  else
    tar --create --file "$archive" --numeric-owner --acls --xattrs --one-file-system --anchored --directory / \
      "${EXCLUDED[@]}" "./${MANIFEST#/}" "./${USER_HOME#/}" "./${KEYRING_HOME#/}" "${members[@]}" || created=$?
  fi
  [ "$created" -eq 0 ] ||
    fail "The archive is not complete. OpenBot stays stopped. Delete $copy and run the export again."
  if openbot_runs; then fail "OpenBot started during the archive. Delete $copy and run the export again."; fi
  if [ "$archive" = - ]; then
    echo "Archived OpenBot $version to standard output."
  else
    echo "Archived OpenBot $version to $archive ($(du -h "$archive" | cut -f1))."
  fi
  if [ -n "$trees" ]; then
    echo "The archive has these directories that the customer added outside the home:"
    # shellcheck disable=SC2086 # One path on each line, with no space.
    du -sh $trees | sed 's/^/  /'
  fi
  if ! listed "$(cat "$USER_HOME/.base-image-version" 2>/dev/null)" "$BASE_IMAGES"; then
    echo "This sandbox has a boat image that the lists of this script do not know. Make sure that the directories above are not from the image."
  fi
  echo "OpenBot stays stopped until this sandbox stops. Do not start it here after the VPS runs."
}

# Puts the moved commands in ~/.local/bin and installs the moved crontab, as the service user. A
# command that ~/.local/bin has already stays as it is. $1 is the manifest.
restore_commands() {
  local links
  links=$(sed -n 's/^link=//p' <<<"$1" | grep -E '^[A-Za-z0-9@_+][A-Za-z0-9@._+-]* /[A-Za-z0-9@._+/-]+$' || true)
  # shellcheck disable=SC2016 # The service user's shell expands these.
  runuser -u "$SERVICE_USER" -- bash -c '
    set -u
    bin=$1 moved=$2 links=$3
    mkdir -p "$bin"
    if [ -d "$moved" ]; then
      for file in "$moved"/*; do
        [ -f "$file" ] && [ ! -L "$file" ] || continue
        [ -e "$bin/${file##*/}" ] || [ -L "$bin/${file##*/}" ] || mv -- "$file" "$bin/"
      done
      rm -rf -- "$moved"
    fi
    while read -r name target; do
      [ -n "$name" ] || continue
      [ -e "$bin/$name" ] || [ -L "$bin/$name" ] || ln -s -- "$target" "$bin/$name"
    done <<<"$links"' _ "$USER_HOME/.local/bin" "$MOVED_BIN" "$links"
  [ -e "$MOVED_CRONTAB" ] || return 0
  if ! command -v crontab >/dev/null; then
    echo "The service user had a crontab in the sandbox. This machine has no cron: the crontab is not installed."
  elif ! runuser -u "$SERVICE_USER" -- crontab "$MOVED_CRONTAB"; then
    echo "The crontab of the sandbox was not installed."
  fi
  runuser -u "$SERVICE_USER" -- rm -f -- "$MOVED_CRONTAB"
}

# Removes what the boat agent server wrote to the home: its tokens (~/.ascii and the blocks of
# ~/.bashrc), its `boat` and `box` commands, its `boat` skill, and its `computer` MCP server. That
# server starts files of the image, and Pi waits for it until OpenBot stops the start of Pi. A part
# that the customer changed stays when the move cannot know it is from boat.
remove_boat_config() {
  # shellcheck disable=SC2016 # The service user's shell expands these.
  runuser -u "$SERVICE_USER" -- bash -c '
    set -u
    cd "$HOME" || exit 1
    for link in .local/bin/*; do
      [ -L "$link" ] || continue
      case $(readlink -- "$link") in "$HOME"/.ascii/*) rm -f -- "$link" ;; esac
    done
    rm -rf -- .ascii .config/ascii
    for skill in .claude/skills/boat .codex/skills/boat .pi/agent/skills/boat .agents/skills/boat; do
      [ "$(ls -A -- "$skill" 2>/dev/null)" = SKILL.md ] && head -n 3 -- "$skill/SKILL.md" | grep -qx "name: sandbox" &&
        grep -q boat-dev -- "$skill/SKILL.md" && rm -rf -- "$skill"
    done
    python3 -I - <<"EOF"
import json, os, re

HOME = os.environ["HOME"]
SERVER = HOME + "/.config/ascii/computer-mcp.py"

def write(path, text):
    mode = os.stat(path).st_mode & 0o777
    with open(path + ".move-tmp", "w") as file:
        file.write(text)
    os.chmod(path + ".move-tmp", mode)
    os.replace(path + ".move-tmp", path)

def without_computer(servers):
    entry = servers.get("computer") if isinstance(servers, dict) else None
    if isinstance(entry, dict) and (entry.get("args") or [None])[0] == SERVER:
        del servers["computer"]
        return True
    return False

def edit_json(path, change):
    try:
        with open(path) as file:
            data = json.load(file)
    except (OSError, ValueError):
        return None
    if isinstance(data, dict) and change(data):
        write(path, json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    return data

def claude(data):
    changed = without_computer(data.get("mcpServers"))
    for project in (data.get("projects") or {}).values():
        if isinstance(project, dict):
            changed = without_computer(project.get("mcpServers")) or changed
    return changed

edit_json(HOME + "/.claude.json", claude)
pi = edit_json(HOME + "/.pi/agent/mcp.json", lambda data: without_computer(data.get("mcpServers")))
# boat adds this extension only for its `computer` server, and the extension takes time from each
# start of Pi. With no other server in the file, nothing uses it.
if isinstance(pi, dict) and not pi.get("mcpServers"):
    def settings(data):
        packages = data.get("packages")
        if isinstance(packages, list) and "npm:pi-mcp-extension" in packages:
            packages.remove("npm:pi-mcp-extension")
            return True
        return False
    edit_json(HOME + "/.pi/agent/settings.json", settings)

def blocks(path, pattern):
    try:
        with open(path) as file:
            text = file.read()
    except OSError:
        return
    cleaned = re.sub(pattern, "", text, flags=re.M | re.S)
    if cleaned != text:
        write(path, cleaned)

blocks(HOME + "/.codex/config.toml",
       r"^# >>> ascii computer use \(managed by the agent server\) >>>\n.*?"
       r"^# <<< ascii computer use \(managed by the agent server\) <<<\n?")
for name in (".bashrc", ".profile", ".bash_profile", ".zshrc"):
    blocks(HOME + "/" + name, r"^# ASCII ([A-Z ]+) START( boat)?\n.*?^# ASCII \1 END( boat)?\n?")
EOF'
}

# An npm package starts with `#!/usr/bin/env node`. The image of a sandbox has Node, and a VPS has
# none. OpenBot downloads Bun to the home, and Bun runs a Node script when it starts with the name
# `node`. So ~/.local/bin/node starts the Bun of OpenBot, which can change version after the move.
# The login shell of an agent has ~/.local/bin in its PATH.
add_node_command() {
  local node=$USER_HOME/.local/bin/node
  [ ! -e "$node" ] && [ ! -L "$node" ] || return 0
  # shellcheck disable=SC2016 # The command expands these when it runs.
  runuser -u "$SERVICE_USER" -- bash -c 'umask 022 && cat >"$1" && chmod 0755 "$1"' _ "$node" <<'EOF'
#!/bin/bash
# The move from boat added this command. It starts the Bun of OpenBot as Node.
bun=$(printf '%s\n' "$HOME"/.config/OpenBot/provider-runtimes/bun/*/*/bin/bun | sort -V | tail -n 1)
if [ ! -x "$bun" ]; then
  echo "node: OpenBot has not downloaded Bun. OpenBot downloads it when an MCP server is on." >&2
  exit 127
fi
exec -a node "$bun" "$@"
EOF
  if ! compgen -G "$USER_HOME/.config/OpenBot/provider-runtimes/bun/*/*/bin/bun" >/dev/null; then
    echo "The moved npm commands need Bun, and OpenBot did not download Bun in the sandbox. OpenBot downloads it when an MCP server is on."
  fi
}

# Installs the apt packages that the customer installed in the sandbox, and names each package that
# this machine cannot install. The service user has no root here, so a package that changes the
# firewall, SSH or root access of this machine is not installed. A package that needs the removal of
# a package of this machine, such as resolvconf, is not installed either. $1 is the manifest.
install_packages_of() {
  local packages="" failed="" refused="" package
  while read -r package; do
    [ -n "$package" ] || continue
    case $package in
      ufw | firewalld | nftables | iptables* | *-persistent | ssh | openssh-server | task-ssh-server | sudo* | \
        opendoas | docker* | containerd* | podman | lxd* | incus* | fail2ban | tailscale | wireguard* | zerotier* | \
        xrdp | *telnetd*)
        refused+=" $package"
        continue
        ;;
    esac
    [ "$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null)" = "install ok installed" ] || packages+=" $package"
  done < <(sed -n 's/^apt=//p' <<<"$1" | grep -E '^[a-z0-9][a-z0-9+.-]+$' || true)
  if [ -n "$refused" ]; then
    echo "These apt packages of the sandbox change the firewall, SSH or root access, and are not installed:$refused"
  fi
  [ -n "$packages" ] || return 0
  echo "Installing the apt packages that the customer installed in the sandbox:$packages"
  apt-get -o DPkg::Lock::Timeout=600 update -q >/dev/null || true
  # shellcheck disable=SC2086 # One word for each package.
  if ! DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=600 install -y -q --no-install-recommends --no-remove \
    $packages >/dev/null 2>&1; then
    for package in $packages; do
      DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=600 install -y -q --no-install-recommends --no-remove \
        "$package" >/dev/null 2>&1 || failed+=" $package"
    done
  fi
  if [ -n "$failed" ]; then echo "This machine cannot install these apt packages of the sandbox:$failed"; fi
}

# Prints why the command at $1 cannot start on this machine, or nothing. It reads the command and does
# not start it (ldd reads a program as the service user): a link must lead to a file, a script to its interpreter and to the program that it
# starts with `exec`, and a program to each library that it loads.
command_problem() {
  local path=$1 depth=${2:-0} real interpreter next rest
  real=$(readlink -f -- "$path") && [ -f "$real" ] || {
    echo "$path is missing"
    return 0
  }
  [ "$depth" -lt 4 ] || return 0
  case $(head -c 4 -- "$real" | od -An -c | tr -d ' \n') in
    177ELF)
      if ldd -- "$real" 2>/dev/null | grep 'not found' >/dev/null; then echo "a library of $real is missing"; fi
      ;;
    '#!'*)
      read -r interpreter next rest < <(head -n 1 -- "$real" | sed 's/^#! *//')
      case $interpreter in */env)
        if [ "$next" = -S ]; then next=${rest%% *}; fi
        interpreter=$(command -v -- "$next") || {
          echo "$next is missing"
          return 0
        }
        ;;
      esac
      command_problem "$interpreter" $((depth + 1))
      next=$(sed -n 's/^ *exec  *"\{0,1\}\(\/[^" ]*\).*/\1/p' -- "$real" | head -n 1)
      if [ -n "$next" ]; then command_problem "$next" $((depth + 1)); fi
      ;;
  esac
}

# Names each command in ~/.local/bin that cannot start here, such as a program for another version
# of Ubuntu or a link to a directory that the move did not copy. The service user reads them.
report_commands() {
  local problems
  # shellcheck disable=SC2016 # The service user's shell expands these.
  problems=$(runuser -u "$SERVICE_USER" -- bash -c "$(declare -f command_problem)"'
    PATH=$1:$PATH
    for command in "$1"/*; do
      [ -e "$command" ] || [ -L "$command" ] || continue
      problem=$(command_problem "$command")
      [ -z "$problem" ] || echo "  ${command##*/}: $problem"
    done' _ "$USER_HOME/.local/bin" 2>/dev/null | LC_ALL=C tr -cd '[:print:]\n') || true
  if [ -n "$problems" ]; then
    printf 'These commands in %s cannot start here:\n%s\n' "$USER_HOME/.local/bin" "$problems"
  fi
}

import_data() {
  [ "$#" -eq 1 ] && [ -f "$1" ] || fail "usage: $0 import <archive>"
  local archive=$1 manifest version installed sums clis groups missing line trees present members group
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

  # The directories that the customer added outside the home. A directory that this machine has
  # already stays as it is.
  trees="" present=""
  while read -r line; do
    [ -n "$line" ] || continue
    movable_tree "$line" || fail "The manifest names a directory that the import must not restore. Nothing was restored."
    if [ -e "$line" ] || [ -L "$line" ]; then present+="  $line"$'\n'; else trees+="$line"$'\n'; fi
  done < <(sed -n 's/^tree=//p' <<<"$manifest")
  members=("./${USER_HOME#/}" "./${KEYRING_HOME#/}")
  group=$(id -gn "$SERVICE_USER")

  # From here, only `discard` makes a second import possible. It removes the directories in the state.
  {
    echo importing
    printf '%s' "$trees" | sed 's/^/tree=/'
  } >"$IMPORT_STATE"
  # Each added directory is new and belongs to the service user. Its parents belong to root.
  while read -r line; do
    [ -n "$line" ] || continue
    (umask 022 && mkdir -p "${line%/*}")
    install -d -o "$SERVICE_USER" -g "$group" -m 0755 "$line"
    members+=("./${line#/}")
  done <<<"$trees"
  # The archive is from a machine where an agent of the customer can get root, and the service user
  # has no root here. So the service user restores it, and only its two directories and the new
  # directories above: the kernel then refuses a file outside them, an owner that is not the service
  # user, a device, a hard link to a file of root, and a file capability. A file that root or another
  # user owned in the sandbox gets the service user as its owner.
  runuser -u "$SERVICE_USER" -- tar --extract --file - --no-same-owner --same-permissions --acls --xattrs \
    --xattrs-include='user.*' --directory / "${members[@]}" <"$archive" ||
    fail "The archive was not restored. Run \"$0 discard $(hostname)\", then run the import again."
  rm -f "$MANIFEST"
  sha256sum --check --quiet <<<"$sums" ||
    fail "A restored file is not the file of the sandbox. Do not start OpenBot. Run \"$0 discard $(hostname)\"."
  if openbot_runs; then fail "OpenBot runs, and the import is not complete. Stop it."; fi
  restore_commands "$manifest"
  remove_boat_config || echo "The boat configuration was not removed from the home."
  # An apt package can install Node, so the Bun command is added only after the packages.
  install_packages_of "$manifest"
  if grep -q '^/usr/local/lib/node_modules/' <<<"$trees" && ! command -v node >/dev/null; then add_node_command; fi
  if openbot_runs; then fail "OpenBot runs, and the import is not complete. Stop it."; fi
  {
    echo imported
    printf 'database=%s\n' "$(sha256sum "$DATABASE" | cut -d' ' -f1)"
    printf '%s' "$trees" | sed 's/^/tree=/'
  } >"$IMPORT_STATE"
  echo "Restored the server of OpenBot $version. This machine has OpenBot $installed, and it does not run."
  echo "Next: when the row of the server names this machine and the sandbox is stopped, run: $0 start"
  echo "Delete $archive on each machine that has a copy."
  if [ -n "$present" ]; then
    printf 'These directories of the customer are on this machine already. The import did not change them:\n%s' "$present"
  fi
  report_commands
  line=$(sed -n 's/^os=//p' <<<"$manifest" | grep -E '^[0-9.]+$' || true)
  if [ -n "$line" ] && [ "$line" != "$(os_version)" ]; then
    echo "The sandbox had Ubuntu $line, and this machine has Ubuntu $(os_version). A program for the other version can fail here."
  fi
  line=$(sed -n 's/^skipped=//p' <<<"$manifest" | grep -E '^[A-Za-z0-9 ._:/@+-]+$' | sed 's/^/  /' || true)
  if [ -n "$line" ]; then
    printf 'The move did not copy these:\n%s\n' "$line"
  fi

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
    echo "The customer did not sign in to these CLIs in the sandbox. OpenBot asks the customer to download a provider CLI before its first use."
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
  # The directories that the import made outside the home. A directory that was here before the
  # import is not in the state.
  sed -n 's/^tree=//p' "$IMPORT_STATE" | while read -r tree; do
    if [ -n "$tree" ] && movable_tree "$tree"; then rm -rf --one-file-system -- "$tree"; fi
  done
  if command -v crontab >/dev/null; then crontab -u "$SERVICE_USER" -r 2>/dev/null || true; fi
  # The copy also gives the home the mode of /etc/skel, so set the mode of a new home again.
  cp -a /etc/skel/. "$USER_HOME/"
  chown -R "$SERVICE_USER:$(id -gn "$SERVICE_USER")" "$USER_HOME"
  mode=$(sed -n 's/^HOME_MODE[[:space:]]*//p' /etc/login.defs | head -n 1)
  chmod "${mode:-0750}" "$USER_HOME"
  rm -f "$IMPORT_STATE"
  echo "Removed the restored data on $(hostname). The apt packages of the import stay. The machine is prepared again: run the import."
}

[ "$(id -u)" -eq 0 ] || fail "Run this as root."
command=${1:-}
shift || true
case $command in
  prepare) prepare "$@" ;;
  upgrade) upgrade "$@" ;;
  packages) packages "$@" ;;
  install-packages) install_packages "$@" ;;
  export) export_data "$@" ;;
  import) import_data "$@" ;;
  start) start "$@" ;;
  discard) discard "$@" ;;
  *) fail "usage: $0 prepare|upgrade|packages|install-packages|export|import|start|discard (the top of this file has the arguments)" ;;
esac
