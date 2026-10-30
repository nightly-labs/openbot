# Docker

The OpenBot image is the Linux release, run as a [self-hosted server](self-hosted-server.md) in a
container. It is a normal Remote host of your account. You use it from the desktop app, the iPhone
app or `openbot.run/app`. The image is `ghcr.io/nightly-labs/openbot`, for `linux/amd64` and
`linux/arm64`.

## Run

With Docker Compose:

```sh
curl -fsSLO https://raw.githubusercontent.com/nightly-labs/openbot/main/docker/compose.yaml
curl -fsSLO https://raw.githubusercontent.com/nightly-labs/openbot/main/docker/seccomp.json
docker compose up -d
docker compose exec openbot openbot login
```

With `docker run`:

```sh
curl -fsSLO https://raw.githubusercontent.com/nightly-labs/openbot/main/docker/seccomp.json
docker run -d --name openbot --restart unless-stopped \
  --security-opt seccomp=seccomp.json --security-opt no-new-privileges:true \
  --shm-size 1g --stop-timeout 60 \
  -v openbot-data:/data \
  ghcr.io/nightly-labs/openbot:latest
docker exec -it openbot openbot login
```

`openbot login` asks for your email and the code that OpenBot sends to it. An operator who sets up
the container for somebody else can use `openbot login --claim` instead (see
[server claims](self-hosted-server.md#sign-in-with-a-server-claim)). After the sign-in, the
server shows in the server list of that account. Then connect a provider from the app, as on a
[hosted server](hosted-servers.md#providers).

To connect the phone app, show a Mobile Connect code in the terminal and scan it with the app:

```sh
docker exec -it openbot openbot mobile-connect
```

See [Phone app](self-hosted-server.md#phone-app).

The options in both examples are necessary:

| Option | Why |
| --- | --- |
| `seccomp=seccomp.json` | The Electron sandbox makes user namespaces. The default seccomp profile of Docker refuses them, and the container stops with a message. See [Security](#security). |
| `--shm-size 1g` | Chromium uses shared memory. The Docker default of 64 MB is too small. When `/dev/shm` is smaller than 1 GiB, Chromium uses `/tmp`, which is slower. |
| `--stop-timeout 60` | OpenBot stops its agents and closes its database before it exits. |
| `-v openbot-data:/data` | All data is in `/data`. Without a volume, it goes away with the container. |

For Amazon ECS, see [AWS ECS](aws-ecs.md).

The container publishes no port. OpenBot only connects out: to the account server, to the providers,
and to Signal and TURN for remote use. The Team API listens on `127.0.0.1` in the container.
The container does not serve a web interface. After `openbot login`, use
[`openbot.run/app`](https://openbot.run/app) with the same account to select the server. A web
client at your own origin is not included in this image. The
[self-hosted account service](self-hosting.md#what-changes) is a separate deployment with its own
client limits.

## Network

The container uses the Docker bridge network. In the container, OpenBot sees only its bridge
address. Devices connect to it through the public address of the host or through TURN. On a public
server, this is sufficient: a test on a VPS gave the same connection time with the bridge network
and with host networking.

When the devices are on the same local network or Tailscale tailnet as the host, the bridge network
can make the connection slow: the container does not see the local or `tailscale0` addresses of the
host, so devices often use TURN. With host networking, OpenBot sees all addresses of the host, and
devices can connect directly. Add `network_mode: host` to the service in `compose.yaml`, or
`--network host` to `docker run`. Host networking is available on Linux with Docker Engine.

Host networking removes the network isolation of the container:

- Other programs on the host can connect to the listeners of OpenBot on `127.0.0.1`. These
  listeners take tokens and team requests.
- Agents can connect to the services of the host that listen only on `127.0.0.1`.
- The virtual displays `:0` and `:1` of the container use abstract X sockets, which are in the
  network namespace. When the host has its own display `:0` or `:1`, the container does not start.
  Other programs on the host can connect to the displays, see the agent display and send input to it.

Use it only on a host where you trust the other programs and users. Do not use it with
[several instances on one host](#several-instances-on-one-host): their firewall works only on the
`openbot` bridge network.

## Tags

| Tag | Image |
| --- | --- |
| `latest` | The newest release. |
| `<version>`, for example `0.30.0` | One release. Use it to choose when to upgrade. |
| `v<version>` | Alias for `<version>` in releases published after 0.31.0. Earlier releases use the tag without `v`. |
| `sha-<commit>` | The release of that commit. |
| `<version>-amd64`, `<version>-arm64` | One release for one architecture. |

Public images need no GHCR sign-in. If `latest` or a version without `v` returns `denied`,
`unauthorized` or `not found`, a maintainer must check the package visibility. See
[Docker package access](RELEASING.md#docker-package-access).

## Data

`/data` is the home folder of the user `openbot` (UID 1000, GID 1000). OpenBot and its agents run as
that user and keep everything there:

| Path | Contents |
| --- | --- |
| `/data/.config/OpenBot` | The database `openbot.db`, logs, the downloaded provider runtimes and the browser data. |
| `/data/OpenBot` | The agent workspaces (`Agents`), `Shared` and `Downloads`. |
| `/data/.local/share/keyrings`, `/data/.config/openbot-container` | The keyring and its password. The keyring has the key of the encrypted data in `/data`. |
| Other files in `/data` | Provider sign-ins and the files of agent tools, for example `~/.codex` and `~/.claude`. |

Keep `/data` as one unit. The encrypted data cannot open without the keyring, and the keyring cannot
open without its password file. Use one volume for one container at a time.

For a bind mount, give the folder to the user of the image first:

```sh
mkdir openbot-data && sudo chown 1000:1000 openbot-data
```

The data has your account session, your provider sign-ins and your conversations. Protect it as you
protect a home folder. To back it up, stop the container and copy the volume. An instance of
`docker/instances` has commands for this, see [Backups](#backups).

## Commands

In the container, `openbot status`, `login`, `mobile-connect`, `logout`, `name` and `version` work as on a
[self-hosted server](self-hosted-server.md#commands). Do the other tasks with Docker on the host:

| Task | Command |
| --- | --- |
| Read the log | `docker logs openbot` |
| Stop, start, restart | `docker stop openbot`, `docker start openbot`, `docker restart openbot` |
| Upgrade | `docker compose pull && docker compose up -d`, or pull the image and make the container again with the same volume |
| Remove | `docker exec openbot openbot logout`, then `docker stop openbot && docker rm openbot`. The data stays in the volume. `docker volume rm openbot-data` deletes it. |

## Several instances on one host

`docker/instances/` runs more than one OpenBot container on one Linux host with systemd. Each
instance has its own CPU, memory and disk limit, its own data and its own account. Copy the `docker`
folder of the repository to the host, for example to `/opt/openbot-docker`, and run as root:

```sh
/opt/openbot-docker/instances/openbot-instance setup
/opt/openbot-docker/instances/openbot-instance create main --cpus 8 --mem 32g --disk 200G
/opt/openbot-docker/instances/openbot-instance run main login
```

| Path | Contents |
| --- | --- |
| `instances/<name>.env` | The name and the limits of the instance. Change `OPENBOT_CPUS` or `OPENBOT_MEM`, then run `openbot-instance up <name>`. `OPENBOT_DISK` is for information only: a change to it does nothing. |
| `/srv/openbot/<name>/data.img` | An ext4 image. Its size is the disk limit. `create` reserves all of it on the disk of the host, so the images can never need more space than the host has. |
| `/srv/openbot/<name>/data` | The mount of the image, which is `/data` in the container. `/etc/fstab` mounts it before Docker starts. `X-fstrim.notrim` stops `fstrim.timer` from freeing the reserved space. |
| `/srv/openbot/<name>/update-requests` | The update requests of the app. The container writes empty files here. It is a tmpfs of 64 KiB and 16 files, which `/etc/fstab` mounts. |
| `/srv/openbot/<name>/update-status` | The state of an update, which root writes. The container can only read it. |

The container is `openbot-<name>`. Its root file system is read-only: the container layer is on the
disk of the host, where Docker on ext4 cannot limit its size. Outside `/data`, the container writes
only to `tmpfs` folders that count toward the memory limit: `/tmp` (8 GiB), `/var/tmp` (1 GiB),
`/run/lock` and `/run/openbot`, and to the small tmpfs of its update requests. Before the image is mounted, root owns the folder, so the container cannot write to
`/data` and stops. It never starts with an empty home folder.

### CPU and memory of the instances

`--cpus` is a CPU time limit. The container still sees every CPU of the host in `/proc/cpuinfo` and
`/proc/stat`, so a program that sizes itself from the CPU count starts too many workers: `next build`
started 63 on a 64-CPU host that gives the instance 8, and two builds filled 32 GiB. `setup`
installs LXCFS with `--enable-cfs` (`lxcfs-openbot.conf`) as its last step; when that fails, it
prints a warning and the rest of the setup stays done. When LXCFS runs, `openbot-instance` adds
`lxcfs.yaml`: the container then reads its own CPU limit in `/proc/cpuinfo`, and its memory limit in
`/proc/meminfo` and `/proc/swaps`. On cgroup v2, LXCFS 5.0 does not limit the CPU lines of
`/proc/stat`, which Node's `os.cpus()` counts, so OpenBot limits the Node programs of agents itself
(see [agent processes](hosted-servers.md#memory)). `nproc`, Python's `os.cpu_count()` and other
programs that read the CPU affinity or `/sys/devices/system/cpu/online` still see the CPUs of the
host. That file is not mounted: LXCFS lists CPUs 0 to limit-1 in it, but a process still runs on any
CPU of the host, and the Gemini CLI then exits with SIGILL. Without LXCFS, an instance still starts
(an update from the app must not fail), and `ready` prints a warning.

An instance gets the LXCFS files when its container is made again: run `openbot-instance up <name>`
after `setup`. A restart of LXCFS breaks its files in the containers that run, so `setup` does not
restart it while a container uses it; each `setup` prints a warning until LXCFS runs with
`--enable-cfs`. Docker starts after LXCFS (`docker-openbot.conf`).

`start` also checks that the container cannot swap (`memory.swap.max` is 0), and prints a warning if
it can, or if it cannot read the value. A container that swaps stops for seconds at a time when its memory is full, and its clients
lose the connection.

### Logs

The container log goes through the `syslog` log driver to a socket of rsyslog,
`/var/lib/openbot-docker/dev/log`, and not to the journal or `/var/log/syslog`, whose size limits
other services share. rsyslog writes `/var/log/openbot/openbot-<name>.log`. logrotate rotates it each
day, or sooner when it is larger than 200 MB. `openbot-logrotate.timer` checks every 5 minutes. It keeps
the 30 newest rotated files and none older than 30 days, so one instance keeps at most 31 files of
about 200 MB. An instance that writes very much keeps less than 30 days. `docker logs` reads the local
cache of Docker, which keeps
only the recent lines. rsyslog cuts a line longer than 8 KB. `setup` installs the rsyslog and logrotate
files and the timer. Its drop-in `docker.service.d/openbot.conf` makes Docker start after rsyslog, because
a container does not start without the socket, and require `openbot-firewall.service`: when the
firewall fails, Docker does not start.

### Host settings

`setup` also installs `/etc/sysctl.d/90-openbot-docker.conf`. With userns-remap, all containers run as
one host user and share its inotify limits, so the file raises them. Each container may open 65536
files (Docker gives 1024 by default). Add `"live-restore": true` to `/etc/docker/daemon.json`, then run
`systemctl reload docker`: a restart or upgrade of Docker then does not stop the instances.

### Isolation

Agents have full access in their container, so the host limits what a container can reach.

- **Network.** `setup` makes the Docker network `openbot` (`172.30.0.0/16`, bridge `br-openbot`)
  with inter-container traffic off, so instances cannot reach each other. It installs
  `openbot-firewall.service`, which runs `instances/openbot-firewall` before Docker starts. The
  chain `OPENBOT-EGRESS` in `DOCKER-USER` drops traffic to private, local and multicast ranges and to
  the addresses in `/etc/openbot-docker/deny`. A rule at the start of `INPUT` drops traffic from the
  bridge to the host. The containers reach only the internet. `create`, `up` and `upgrade` refuse
  to start a container when the firewall is off.
- **Other servers.** Traffic from a container leaves with the address of the host. Put servers that
  trust that address in `/etc/openbot-docker/deny`, one per line, then run `setup` again.
- **Users.** With `"userns-remap": "default"` in `/etc/docker/daemon.json`, UID 1000 in the
  container is the start of the `dockremap` range in `/etc/subuid` plus 1000 on the host, a user with
  no rights there. `create` gives the data to that user. This setting is for the whole Docker
  daemon: Docker then uses another data folder, so containers, images and networks made before are
  not visible until it is removed. To turn it on for existing instances: `down` each instance, add
  the setting, restart Docker, run `setup`, `chown -R <uid>:<gid>` each `/srv/openbot/<name>/data`,
  then `up` each instance. `setup` shows a warning when it is off.
- **DNS.** Docker sends the DNS queries of a container from the network of the container, so the
  firewall also applies to them. When the host uses a resolver on a private or link-local address,
  for example on AWS or GCP, the containers have no DNS. Then set `dns:` in `compose.yaml` to
  resolvers on the internet.
- **Kernel.** The containers share the kernel of the host. For owners that you do not trust, use a
  host with no other services, or a virtual machine for each instance.

| Task | Command |
| --- | --- |
| Show the instances | `openbot-instance list` |
| Stop, start, restart | `openbot-instance down <name>`, `up <name>`, `restart <name>` |
| Read the log | `openbot-instance logs <name> -f` (recent lines), or `/var/log/openbot/openbot-<name>.log*` (30 days) |
| Upgrade | In the app (see [Updates from the app](#updates-from-the-app)), or `openbot-instance upgrade <name>` or `upgrade --all` |
| `openbot` commands | `openbot-instance run <name> status`, `login`, `mobile-connect`, `name <name>` |
| Make the disk larger | `down <name>`, `umount /srv/openbot/<name>/data`, `fallocate --length <new size> data.img`, `e2fsck -f data.img`, `resize2fs data.img`, `mount /srv/openbot/<name>/data`, `up <name>` |

There is no command to remove an instance. To remove one and delete its data: `run <name> logout`,
`down <name>`, `systemctl disable --now openbot-instance-update@<name>.path`,
`umount /srv/openbot/<name>/data /srv/openbot/<name>/update-requests`, delete its two lines in
`/etc/fstab`, then delete `/srv/openbot/<name>` and `instances/<name>.env`.

### Updates from the app

The owner or an admin updates an instance in Server settings › Updates, or in the update dialog, as on a
hosted server. The container never gets the Docker socket. OpenBot writes an empty request file to
`/srv/openbot/<name>/update-requests`. `openbot-instance-update@<name>.path` sees it and runs
`openbot-instance update-request <name>` as root. Root only tests and removes the request; it never
reads or follows it. It pulls the image of the instance and writes its version to `update-status` only
when it is newer than the container. For an install, it makes the container again from that image,
with the same data. It writes the state of the request to `update-status`, which the container mounts
read-only.

`setup` installs the units. `create`, `up` and `upgrade` make the folders, add the tmpfs of the
requests to `/etc/fstab` and enable the path unit of the instance. An instance with `OPENBOT_TAG` in
its env file keeps that tag and offers no update in the app. An instance made before this release gets them with `setup`, then
`openbot-instance upgrade <name>` once. A container started with `docker/compose.yaml` or
`docker run` has no request folders, so it offers no update in the app.

### Backups

`openbot-instance backup <name>` copies all of `/data` of an instance into one archive: the
conversations, attachments, agents, routines, memories, skills, workspaces, `Shared` with the shared
tables, both databases, the provider sign-ins and the keyring with its password. A restore of this
archive gives back the same instance, with the same agent, conversation and memory IDs. It is not a
[transfer](architecture/agents.md#instance-transfer), which adds agents with new IDs to another server.

Set the folder of the backups in `instances/<name>.env`, then run the first backup as root:

```sh
echo OPENBOT_BACKUP_DIR=/var/backups/openbot >>/opt/openbot-docker/instances/main.env
/opt/openbot-docker/instances/openbot-instance backup main --verify
```

| Setting | Use |
| --- | --- |
| `OPENBOT_BACKUP_DIR` | The folder of the backups. Each instance has the folder `<name>` in it. It must not be in the data of an instance, because a backup has the keys of the instance. Use another disk, or copy the folder to another computer. |
| `OPENBOT_BACKUP_KEEP` | The number of complete backups to keep. The default is 7. An older backup is deleted only after a new one is complete, and with `--verify` only after the new one is verified. |
| `OPENBOT_BACKUP_MAX_AGE` | Hours. When the newest complete backup is older, `backups` shows it as overdue and exits with 1. |
| `OPENBOT_BACKUP_WORK` | The folder where `verify` unpacks a backup. The default is `/var/tmp`. It needs free space for the data, and the user of the data must be able to reach it. |

A backup stops the container, waits until OpenBot closes its databases, writes the archive and starts
the container again. The instance is offline while the archive is written. The output and the status
show how long. A running turn stops, as on a restart. Each backup is a folder `<UTC time>` with:

| File | Contents |
| --- | --- |
| `data.tar.zst` | `/data` without `lost+found`. With `gzip` (`data.tar.gz`) when the host has no `zstd`. |
| `manifest.json` | The OpenBot version and image, the size, the checksum of the archive, the folders in `/data`, the stop and the time offline. |
| `required.sha256` | The checksums of `openbot.db`, the keyring, its password and `agent-data.db`. |
| `instance.env` | A copy of the env file of the instance. |
| `SHA256SUMS` | The checksums of the other files. |
| `verified.json` | The result of the last verification, when there is one. |

The backup writes to `<UTC time>.partial` and renames the folder only when all files are written. A
backup fails, and keeps the earlier backups, when a file cannot be read, the folder has less free space
than the data uses, the copy stops, or the database or the keyring is missing.

`openbot-instance verify <name> [<backup>]` checks the newest backup or the one given. It needs
`sqlite3` 3.37 or later on the host. It compares the checksums, unpacks the archive into a temporary
folder in `OPENBOT_BACKUP_WORK`, and checks that the database, the keyring and its password are there and
are the files that were copied. It runs `PRAGMA integrity_check` on both databases, reads the schema
version, counts agents, threads, messages, memories and shared tables, and finds shared tables whose
owner is not an agent of the backup. Nothing in the folder runs: no routine starts and no message goes
out. Root does not unpack the archive or open a database, because agents can change every file in
`/data`. The user of the data does that, and `sqlite3` runs in `-safe` mode. Thus that user (UID 1000
without user namespace remapping) can read the temporary folder until verification deletes it.
Verification does not check each attachment file.

`openbot-instance backups <name>` shows the backups and the last backup and verification, with the
error when one failed. `--json` gives the same for a monitor, with `lastBackup` and `lastVerify` set to
`ok`, `failed`, `running`, `stopped` or `none`. `stopped` means that the run ended without a result, for
example when it was killed or the host restarted. It exits with 1 when the last backup or verification
failed or stopped, or the newest backup is overdue. Root keeps the state in
`/srv/openbot/<name>/backup-status`.

A daily backup at 04:00, with a verification after it:

```sh
systemctl enable --now openbot-instance-backup@main.timer
systemctl edit openbot-instance-backup@main.timer   # another time: OnCalendar= under [Timer]
```

The timer runs outside the container, so it also backs up an instance that does not work. `setup`
installs the units. Backups, verifications, restores, updates, `up`, `down`, `restart` and `upgrade` of
one instance take the same lock. One waits until the other ends, so none starts or stops the container
while another runs.

To restore, the instance must exist. For a new host, `create` it with the same name first.

```sh
openbot-instance restore main 20261014T040000Z --replace
openbot-instance up main
```

`restore` checks the checksums and verifies the backup in a temporary folder before it stops the
container. It uses the same checks and temporary space as `verify`, even if the backup was verified
before. Thus `restore` also needs `sqlite3` 3.37 or later on the host. A failed verification keeps
the target in its current state and its data unchanged. The verification status records the failure
and keeps the last successful result. After verification, `restore` stops the container and unpacks
the backup next to the data. Only when the archive is unpacked does it replace `/data`. When the
instance has data, `restore` needs `--replace`, which deletes that data, so back it up first.
Because the old data stays until the end, the disk of the instance needs free space for the data of
the backup. When it has less, copy the old data to another disk, delete it from
`/srv/openbot/<name>/data`, and restore into the empty folder.
`restore` does not start the instance:

- Start it only when the instance of the backup does not run anywhere else. Two copies would use the
  same server identity and the same account session.
- `restore` refuses a backup from a newer OpenBot than the image of the instance. Pull a newer image
  first. An older OpenBot cannot open a database that a newer one migrated. Do not use a backup to go
  back to an older version.
- A newer OpenBot migrates the database on its first start. Back up the restored data again before you
  upgrade when you want to keep the version that the backup had.
- The provider sign-ins are in the backup. A provider can still ask for a new sign-in when its session
  expired. The account session is in the backup too.

## Upgrades

OpenBot does not update itself in a container. A new image replaces it. An instance of
`docker/instances` can ask the host for that from the app, see
[Updates from the app](#updates-from-the-app). Do not go back to an older tag: an older OpenBot cannot
open a database that a newer one migrated, so it does not start.

### Update automation

`latest` follows the newest published release. The release workflow does not publish a floating
minor tag such as `0.39`, or a separate `stable` tag. For a controlled upgrade, keep an exact
version in your Compose file or `OPENBOT_TAG` in the instance env file.

The [GitHub latest-release API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)
is the machine-readable source for the newest full release. For example, this read-only command
prints its tag:

```sh
gh api repos/nightly-labs/openbot/releases/latest --jq '.tag_name'
```

Automation can poll that metadata and download an image. Installation needs these checks:

1. Read the release notes and check that the candidate is newer than the running version. Stop on
   an API error or an unexpected tag. Do not substitute `latest` for a failed version lookup.
2. Compare your deployment files with the files at the candidate release tag. Check
   `docker/compose.yaml` and `docker/seccomp.json`. For an instance of `docker/instances`, check
   the `docker/instances/` files too. These files can change between releases; there is no promise
   that an old copy remains sufficient. Stop for operator review when they change. Keep local
   settings.
3. Pull the exact image tag and check its release version and architecture before replacing the
   container. The release workflow publishes the GitHub release before the image tags, so a new
   release can appear while its image is not available yet. A failed pull leaves installation pending.
4. Back up the complete `/data` recovery unit, including the keyring and password file. For an
   instance of `docker/instances`, run `openbot-instance backup <name> --verify`, see
   [Backups](#backups). For a container from `docker/compose.yaml` or `docker run`, stop the
   container, confirm that it stopped, and copy the volume, see [Data](#data). Keep the previous
   complete backup.
5. Replace the container with the chosen image and the same volume and runtime options. For an
   instance of `docker/instances`, set `OPENBOT_TAG` in its env file and run
   `openbot-instance upgrade <name>`. This command takes the lock of the instance, so no backup,
   restore or update from the app runs at the same time. A manual replacement does not take the
   lock. Check `openbot status` and the container log before the upgrade is reported as complete.

An unattended image watcher does not perform these checks or make a consistent backup. Keep the
installation step under operator control unless your own job implements them. A failed upgrade
must not start an older image against the upgraded data. Recovery uses the complete backup with
a compatible release, not an image-tag rollback of the live volume.

## Memory

The container uses the memory guards of a hosted server (see [Memory](hosted-servers.md#memory)).
When free memory is low, new turns wait in the queue and start again when memory is available. A
message from a person starts first. The browser opens no new tab and unloads idle pages sooner.

The memory ceiling is the smaller of the memory of the host and the memory limit of the container
(`--memory`, or `mem_limit` in Compose). Without a limit, the ceiling is the memory of the host. A
fixed number of turns run at the same time: 2 up to 5 GiB of ceiling, 8 up to 10 GiB, and 16 above.
`/dev/shm` and the `tmpfs` folders count toward the limit too. `docker exec openbot openbot status`
shows the ceiling, the free memory, the level (`ok`, `low` or `critical`) and the turn limit.

The guard reads cgroup v2, which current Docker hosts use. On a host with cgroup v1, the container
sees only the memory of the host, so the guard uses it, and the log has one warning.

Main has an OOM score adjustment of 0 in the container, and each process that it starts gets 500.
So when the container is out of memory, the kernel is more likely to stop a provider CLI, an MCP
server or an agent tool than OpenBot. Agent processes also run at nice 10, and at the `critical` level
main stops leftover agent processes, such as the workers of a build whose parent was stopped. See
[agent processes](hosted-servers.md#memory).

## Environment

Pass these with `-e` or the `environment` of the Compose file, never in an image. Agents inherit the
environment of OpenBot, so they can read these values.

| Variable | Use |
| --- | --- |
| `XAI_API_KEY`, `CURSOR_API_KEY`, `CLINE_API_KEY` | A provider API key. |
| `OPENBOT_CODEX_PATH`, `OPENBOT_CLAUDE_PATH`, `OPENBOT_GROK_PATH`, `OPENBOT_OPENCODE_PATH`, `OPENBOT_CURSOR_PATH`, `OPENBOT_CLINE_PATH`, `OPENBOT_ANTIGRAVITY_PATH`, `OPENBOT_PI_PATH`, `OPENBOT_MUSE_PATH` | Another provider executable. Mount it read-only in the container. |
| `OPENBOT_AUTH_API_URL` | Another account server, for example a [self-hosted account service](self-hosting.md). |
| `OPENBOT_DISPLAY_SIZE` | The size of the virtual display that computer use reads, as `WIDTHxHEIGHT` from 640x480 to 2576x2576. The default is 1280x800. A value that is not valid writes a warning in `docker logs`, and the container starts with 1280x800. See [Display size](self-hosted-server.md#display-size) for when to use 1920x1080. `docker/instances/compose.yaml` does not pass it, so an instance uses 1280x800. |

## Security

- **The Electron sandbox stays on.** `seccomp.json` is the default profile of Docker
  ([moby/profiles](https://github.com/moby/profiles/blob/6fe7deb1b9fb7c0397a4593480d7d22b9ee8caef/seccomp/default.json))
  with one more rule: `clone` and `unshare` without limits on their flags. This lets the container
  make user namespaces, which gives processes in the container more of the kernel to call. The kernel
  still refuses other namespaces to a process that is not in its own user namespace. Do not use
  `seccomp=unconfined`, `--privileged` or `--no-sandbox` instead.
- **Not root.** The image runs as UID 1000. Root owns the release, so agents cannot change it. The
  release has no SUID file. `no-new-privileges` keeps it that way.
- **Agents have full access in the container.** They run commands, change all of `/data` and use the
  network. The container is the boundary. Do not mount the Docker socket, your home folder or another
  host folder that agents must not change.
- **Check the image.** Each release image has a build provenance attestation:

  ```sh
  gh attestation verify oci://ghcr.io/nightly-labs/openbot:<version> --repo nightly-labs/openbot
  ```

## How it works

The release workflow (`.github/workflows/release.yml`) builds the image on a runner of each
architecture from the AppImage of that release, after it checks the AppImage against the release
checksums. `docker/Dockerfile` unpacks the AppImage to `/opt/OpenBot/app` and installs the packages
of a self-hosted server from that release. The workflow starts and stops each image once, and pushes
the images to GHCR only after the GitHub Release is published.

`tini` is process 1. It starts `resources/hosting/openbot-container` from the release, which checks
that it can make a user namespace, starts D-Bus, two virtual displays and the keyring, and then
becomes OpenBot with `OPENBOT_SERVER=1`. OpenBot shows its windows on `:0`, at 1280x800. The agents
work on `:1`, at the size of `OPENBOT_DISPLAY_SIZE`, which the script names in
`OPENBOT_AGENT_DISPLAY`. Computer Use and remote desktop use `:1`, so they do not show the OpenBot
window. On a stop, tini gives the signal to OpenBot and waits for it.
`/opt/OpenBot/hosted/mode` is `container`, so the `openbot` command talks to the control socket and
does not use systemd.

## Limits

- Remote desktop and Computer Use need a display. The container has a virtual display for the
  agents, but remote desktop and Computer Use were not tested in it. The arm64 release has no remote desktop runtime.
- Voice prompts are not available: the container has no microphone, and the web app has no voice prompts.
- Gemini signs in on a Google page in the browser of the container. An owner or admin opens it
  with Connect in the app, and signs in through the live view of that page. This needs a release
  with `provider-host-sign-in-v1` on both sides. It was not tested in a container.
- Bitwarden and Vaultwarden connect with an API key and the master password (`bitwarden-connector-v1`).
  The container must reach the vault server over HTTPS. On a host with several instances, the
  firewall blocks private addresses, so a Vaultwarden server on the local network cannot be used.

## Not confirmed

- Tested on Docker Desktop 4.45 (Docker Engine 28.3, `linux/arm64`) with the 0.29.0 AppImage and the
  scripts of this image: the start with the sandbox on, `openbot status`, a restart, a new container
  on the same volume after a kill, a stop that exits with 0, and the messages for a missing seccomp
  profile and for a volume that the user cannot write. The release workflow also starts each image.
- Not tested: a sign-in with `openbot login` in a container, remote use of a container from the app,
  Podman, Kubernetes, rootless Docker, and hosts that restrict user namespaces with AppArmor, such as
  Ubuntu 23.10 or newer. On such a host, the container can need an AppArmor profile that permits
  `userns`.
- Host networking: users report that it makes the connection fast on a local network and on a
  Tailscale tailnet. This was not tested here. On a public Ubuntu 24.04 VPS with Docker 29, the
  bridge network connected in 2.0 to 2.6 s and host networking in 2.0 to 2.4 s.
- The two displays of the entrypoint were tested with a stand-in for OpenBot: `:0` is 1280x800 and
  `:1` has the display size. Computer Use and remote desktop on `:1` were not tested.
- Not tested: a Codex agent with Workspace only access in a container. Codex runs its commands in
  bubblewrap, which mounts its root in a user namespace. The seccomp profile allows `mount` only with
  `CAP_SYS_ADMIN` and always refuses `pivot_root`, and the `docker-default` AppArmor profile refuses
  `mount`, so these commands can fail. An agent with Full access does not use bubblewrap.
