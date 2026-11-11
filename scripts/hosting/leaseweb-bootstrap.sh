#!/bin/bash
# Hardens a Leaseweb VPS that runs OpenBot as a server for a customer. Run it once as root, after
# install-server.sh:
#
#   ssh root@<address> 'bash -s' <scripts/hosting/leaseweb-bootstrap.sh
#
# A release also has it, in /opt/OpenBot/app/resources/hosting. Run it again to apply a newer
# version: it does not restart OpenBot, and a second run gives the same state.
#
# 1. SSH accepts keys only. Leaseweb installs no key on a VPS. Give the public keys of the operators,
#    one for each person, as one base64 argument:
#
#      ssh root@<address> bash -s "$(base64 <operator-keys | tr -d '\n')" <scripts/hosting/leaseweb-bootstrap.sh
#
#    An operator key signs in as root, and as no other user. The list replaces the list of the last
#    run, so a run with a shorter list removes a person. A run with no argument keeps the list. This
#    file has no key in it, because each release has this file. Without an operator key, an operator
#    who signs in with the root password of the Leaseweb API has no SSH access after this session.
#    The password still works on the console of the Leaseweb API, which is the way back in.
# 2. Egress rules. The CloudStack router (the DHCP server) gives the metadata of the VPS and, after
#    a password reset, its root password to each process that asks. The service user, which runs
#    OpenBot and its agents, cannot connect to the router or to private, link-local and multicast
#    addresses. No user can connect to TCP port 25, so the server cannot send mail directly. The
#    ports 465 and 587 stay open. OpenBot does not start without the rules.
# 3. Security updates install each day. They restart neither the server nor OpenBot: a restart stops
#    agent turns, so the operator plans it. Ubuntu restarts each other service that uses an updated
#    library (needrestart).
# 4. A new kernel gets a boot entry. The Ubuntu 26.04 image of Leaseweb starts with GRUB but has no
#    GRUB package, so a kernel update never starts. The package writes GRUB to the disk again. Restart
#    the server one time after the first run, before a customer uses it: scripts/hosting/
#    leaseweb-bootstrap-e2e.ts does that with --restart=yes.
#
# The rules refuse the service user the addresses of a container network (172.16.0.0/12) and of a
# VPN in 100.64.0.0/10 or a private range. Change PRIVATE4 in /usr/local/sbin/openbot-egress-firewall
# for a server that needs one.
# scripts/hosting/leaseweb-bootstrap-e2e.ts tests this file on a VPS. See docs/hosted-servers.md.
set -euo pipefail
export LC_ALL=C DEBIAN_FRONTEND=noninteractive

INSTALL=/opt/OpenBot
HELPER=/usr/local/sbin/openbot-egress-firewall
UNIT_DIRECTORY=/etc/systemd/system
OPERATOR_KEYS=/etc/ssh/openbot-operator-keys

fail() {
  echo "$*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail "Run this as root."
[ "$#" -le 1 ] || fail "usage: $0 [<operator keys in base64>]"
[ -d /run/systemd/system ] || fail "This computer has no systemd."
[ -r "$INSTALL/hosted/service-user" ] || fail "OpenBot is not installed. Run install-server.sh first."
command -v nft >/dev/null || fail "This computer has no nft command."

# Writes standard input to a file, and sets "changed" when the content is new. Not
# "install /dev/stdin": the install command of Ubuntu 26.04 (uutils) refuses that source when the
# target exists. The temporary name starts with a dot, so sshd, apt and systemd do not read it.
changed=0
write_file() {
  local mode=$1 target=$2 temporary
  temporary=$(mktemp "$(dirname "$target")/.openbot.XXXXXX")
  cat >"$temporary"
  chmod "$mode" "$temporary"
  if cmp -s "$temporary" "$target"; then
    rm -f "$temporary"
    chmod "$mode" "$target"
  else
    mv -f "$temporary" "$target"
    changed=1
  fi
}

# 1. Each line of the operator keys is a comment or one public key with no options. One bad line
# stops the run before a change, so a damaged list cannot remove the access of the operators.
if [ "$#" -eq 1 ]; then
  decoded=$(base64 -d <<<"$1" 2>/dev/null) || fail "The operator keys are not base64."
  key_line='^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]+=*( .*)?$'
  operator_keys=()
  while IFS= read -r line; do
    case "$line" in '' | '#'*) continue ;; esac
    [[ $line =~ $key_line ]] && ssh-keygen -l -f - <<<"$line" >/dev/null 2>&1 ||
      fail "Key $((${#operator_keys[@]} + 1)) of the operator keys is not a public key with no options."
    operator_keys+=("$line")
  done <<<"$decoded"
  [ "${#operator_keys[@]}" -gt 0 ] || fail "The operator keys have no key."
  install -d -m 0755 "$OPERATOR_KEYS"
  write_file 0644 "$OPERATOR_KEYS/root" < <(printf '%s\n' "${operator_keys[@]}")
fi

# sshd uses the first value that it reads, so 00- comes before 50-cloud-init.conf. %u is the name
# of the user who signs in, and only root has a file of operator keys.
write_file 0644 /etc/ssh/sshd_config.d/00-openbot-hardening.conf <<EOF
AuthorizedKeysFile .ssh/authorized_keys .ssh/authorized_keys2 $OPERATOR_KEYS/%u
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PermitEmptyPasswords no
MaxAuthTries 3
X11Forwarding no
AllowTcpForwarding no
AllowAgentForwarding no
EOF
sshd -t
# ssh.service does not run before the first connection when the socket starts it.
systemctl try-reload-or-restart ssh.service

# 2. The helper loads the rules. It runs before the network starts, with the router of the last run,
# and again before each start of OpenBot, when the DHCP lease can name another router.
install -d -m 0755 /etc/openbot
write_file 0755 "$HELPER" <<'EOF'
#!/bin/bash
# Loads the egress rules of an OpenBot server on a Leaseweb VPS. leaseweb-bootstrap.sh installs
# this file and explains the rules.
set -euo pipefail
export LC_ALL=C
STATE=/etc/openbot/egress-router
PRIVATE4="0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 169.254.0.0/16, 172.16.0.0/12, 192.0.0.0/24, 192.168.0.0/16, 198.18.0.0/15, 224.0.0.0/4, 240.0.0.0/4"

user=$(</opt/OpenBot/hosted/service-user)
uid=$(id -u "$user")
# The DHCP servers of the current leases of systemd-networkd. None before the network starts.
routers=$(sed -n 's/^SERVER_ADDRESS=//p' /run/systemd/netif/leases/* 2>/dev/null | sort -u | paste -sd, - || true)
valid='^([0-9]{1,3}\.){3}[0-9]{1,3}(,([0-9]{1,3}\.){3}[0-9]{1,3})*$'
if [[ $routers =~ $valid ]]; then
  if [ "$routers" != "$(cat "$STATE" 2>/dev/null || true)" ]; then
    printf '%s\n' "$routers" >"$STATE.new"
    mv -f "$STATE.new" "$STATE"
  fi
else
  routers=$(cat "$STATE" 2>/dev/null || true)
  [[ $routers =~ $valid ]] || {
    echo "The DHCP server of this computer is not known. The egress rules are not loaded." >&2
    exit 1
  }
fi

# One transaction: the new table replaces the old one with no moment without rules.
nft -f - <<RULES
table inet openbot_egress
delete table inet openbot_egress
table inet openbot_egress {
  set private4 {
    type ipv4_addr; flags interval
    elements = { $PRIVATE4, $routers }
  }
  set private6 {
    type ipv6_addr; flags interval
    elements = { fc00::/7, fe80::/10, ff00::/8 }
  }
  chain output {
    type filter hook output priority filter; policy accept;
    oifname "lo" accept
    tcp dport 25 counter reject with tcp reset comment "no direct mail"
    meta skuid $uid ip daddr @private4 counter reject comment "service user: no local ranges or metadata"
    meta skuid $uid ip6 daddr @private6 counter reject comment "service user: no local ranges"
  }
}
RULES
EOF

# Only a new unit file needs a reload of systemd.
changed=0
write_file 0644 "$UNIT_DIRECTORY/openbot-egress-firewall.service" <<EOF
[Unit]
Description=OpenBot egress rules
DefaultDependencies=no
Wants=network-pre.target
Before=network-pre.target shutdown.target openbot.service
Conflicts=shutdown.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$HELPER
ExecStop=/usr/sbin/nft delete table inet openbot_egress

[Install]
WantedBy=multi-user.target
EOF
# A drop-in, because each release installs its own openbot.service. As root (+).
install -d -m 0755 "$UNIT_DIRECTORY/openbot.service.d"
write_file 0644 "$UNIT_DIRECTORY/openbot.service.d/10-egress-firewall.conf" <<EOF
[Unit]
Requires=openbot-egress-firewall.service
After=openbot-egress-firewall.service

[Service]
ExecStartPre=+$HELPER
EOF
if [ "$changed" -eq 1 ]; then systemctl daemon-reload; fi
systemctl enable --quiet openbot-egress-firewall.service
# Not a restart of the unit: that stops OpenBot, which requires it.
"$HELPER"
systemctl start openbot-egress-firewall.service

# 3. Security updates only.
if ! dpkg-query -W -f='${Status}' unattended-upgrades 2>/dev/null | grep -q '^install ok installed$'; then
  apt-get -o DPkg::Lock::Timeout=600 update
  apt-get -o DPkg::Lock::Timeout=600 install -y --no-install-recommends unattended-upgrades
fi
write_file 0644 /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
write_file 0644 /etc/apt/apt.conf.d/52openbot-unattended <<'EOF'
#clear Unattended-Upgrade::Allowed-Origins;
Unattended-Upgrade::Allowed-Origins {
  "${distro_id}:${distro_codename}-security";
  "${distro_id}ESMApps:${distro_codename}-apps-security";
  "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
# After an update, needrestart restarts the services that use an old library. Not OpenBot.
install -d -m 0755 /etc/needrestart/conf.d
write_file 0644 /etc/needrestart/conf.d/50-openbot.conf <<'EOF'
$nrconf{override_rc}{qr(^openbot\.service$)} = 0;
EOF
systemctl enable --quiet --now unattended-upgrades.service apt-daily.timer apt-daily-upgrade.timer

# 4. Without update-grub, no command adds a new kernel to the boot menu. The boot arguments of the
# image stay (on Leaseweb: net.ifnames=0), and the 5 seconds in which the console can open the menu.
if ! command -v update-grub >/dev/null; then
  boot_disk=$(lsblk -no PKNAME "$(findmnt -no SOURCE /)" 2>/dev/null || true)
  if [ ! -d /sys/firmware/efi ] && [ -d /boot/grub/i386-pc ] && [ -b "/dev/$boot_disk" ]; then
    arguments=$(tr ' ' '\n' </proc/cmdline | grep -v -E '^(BOOT_IMAGE=.*|root=.*|ro|quiet|splash)$' | paste -sd' ' - || true)
    install -d -m 0755 /etc/default/grub.d
    write_file 0644 /etc/default/grub.d/50-openbot.cfg <<EOF
GRUB_CMDLINE_LINUX="$arguments"
GRUB_TIMEOUT=5
EOF
    echo "grub-pc grub-pc/install_devices multiselect /dev/$boot_disk" | debconf-set-selections
    apt-get -o DPkg::Lock::Timeout=600 update
    apt-get -o DPkg::Lock::Timeout=600 install -y --no-install-recommends grub-pc
  else
    echo "This computer has no update-grub command and does not start with GRUB for BIOS. A new kernel can have no boot entry." >&2
  fi
fi

echo "The server is hardened. Router: $(<"/etc/openbot/egress-router"). Operator keys: $(grep -c . "$OPERATOR_KEYS/root" 2>/dev/null || true)."
