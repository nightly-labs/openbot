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

`openbot login` asks for your email and the code that OpenBot sends to it. After the sign-in, the
server shows in the server list of that account. Then connect a provider from the app, as on a
[hosted server](hosted-servers.md#providers).

The options in both examples are necessary:

| Option | Why |
| --- | --- |
| `seccomp=seccomp.json` | The Electron sandbox makes user namespaces. The default seccomp profile of Docker refuses them, and the container stops with a message. See [Security](#security). |
| `--shm-size 1g` | Chromium uses shared memory. The Docker default of 64 MB is too small. |
| `--stop-timeout 60` | OpenBot stops its agents and closes its database before it exits. |
| `-v openbot-data:/data` | All data is in `/data`. Without a volume, it goes away with the container. |

The container publishes no port. OpenBot only connects out: to the account server, to the providers,
and to Signal and TURN for remote use. The Team API listens on `127.0.0.1` in the container.

## Tags

| Tag | Image |
| --- | --- |
| `latest` | The newest release. |
| `<version>`, for example `0.30.0` | One release. Use it to choose when to upgrade. |
| `sha-<commit>` | The release of that commit. |
| `<version>-amd64`, `<version>-arm64` | One release for one architecture. |

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
protect a home folder. To back it up, stop the container and copy the volume.

## Commands

In the container, `openbot status`, `login`, `logout`, `name` and `version` work as on a
[self-hosted server](self-hosted-server.md#commands). Do the other tasks with Docker on the host:

| Task | Command |
| --- | --- |
| Read the log | `docker logs openbot` |
| Stop, start, restart | `docker stop openbot`, `docker start openbot`, `docker restart openbot` |
| Upgrade | `docker compose pull && docker compose up -d`, or pull the image and make the container again with the same volume |
| Remove | `docker exec openbot openbot logout`, then `docker stop openbot && docker rm openbot`. The data stays in the volume. `docker volume rm openbot-data` deletes it. |

## Upgrades

OpenBot does not update itself in a container. A new image replaces it. Do not go back to an older
tag: an older OpenBot cannot open a database that a newer one migrated, so it does not start.

## Environment

Pass these with `-e` or the `environment` of the Compose file, never in an image. Agents inherit the
environment of OpenBot, so they can read these values.

| Variable | Use |
| --- | --- |
| `XAI_API_KEY`, `CURSOR_API_KEY`, `CLINE_API_KEY` | A provider API key. |
| `OPENBOT_CODEX_PATH`, `OPENBOT_CLAUDE_PATH`, `OPENBOT_GROK_PATH`, `OPENBOT_OPENCODE_PATH`, `OPENBOT_CURSOR_PATH`, `OPENBOT_CLINE_PATH`, `OPENBOT_ANTIGRAVITY_PATH` | Another provider executable. Mount it read-only in the container. |
| `OPENBOT_AUTH_API_URL` | Another account server, for example a [self-hosted account service](self-hosting.md). |

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
that it can make a user namespace, starts D-Bus, a virtual display and the keyring, and then becomes
OpenBot with `OPENBOT_SERVER=1`. On a stop, tini gives the signal to OpenBot and waits for it.
`/opt/OpenBot/hosted/mode` is `container`, so the `openbot` command talks to the control socket and
does not use systemd.

## Limits

- Remote desktop and Computer Use need a display. The container has a virtual display, but remote
  desktop and Computer Use were not tested in it. The arm64 release has no remote desktop runtime.
- Voice prompts are not available on Linux.

## Not confirmed

- Tested on Docker Desktop 4.45 (Docker Engine 28.3, `linux/arm64`) with the 0.29.0 AppImage and the
  scripts of this image: the start with the sandbox on, `openbot status`, a restart, a new container
  on the same volume after a kill, a stop that exits with 0, and the messages for a missing seccomp
  profile and for a volume that the user cannot write. The release workflow also starts each image.
- Not tested: a sign-in with `openbot login` in a container, remote use of a container from the app,
  Podman, Kubernetes, rootless Docker, and hosts that restrict user namespaces with AppArmor, such as
  Ubuntu 23.10 or newer. On such a host, the container can need an AppArmor profile that permits
  `userns`.
