# Self-hosted servers

A self-hosted server is the Linux OpenBot build on your own computer with no screen: a VPS, a home
server or a cloud VM. It is a normal Remote host of your account. You use it from the desktop app,
the iPhone app or `openbot.run/app`, as you use a [hosted server](hosted-servers.md). You install
and control it from a terminal.

To run it in a container, see [Docker](docker.md).

## Install

On Ubuntu 24.04 or 26.04 (x86_64 or arm64) with systemd:

```sh
curl -fsSL https://raw.githubusercontent.com/nightly-labs/openbot/main/scripts/install-server.sh | sudo bash
sudo openbot login
```

`openbot login` asks for your email and the code that OpenBot sends to it. After the sign-in, the
server shows in the server list of that account. Its name is "OpenBot"; give another one with
`sudo openbot login --name <name>` or `sudo openbot name <name>`. A name has 6 to 32 characters.
Then connect a provider from the app, as on a hosted server (see
[Providers](hosted-servers.md#providers)).

### Sign in with a server claim

An operator who sets up a server for somebody else can sign it in with no code. The operator makes a
one-time claim for the owner's email, and the server redeems it. The owner does nothing: when they
sign in to OpenBot with that email, the server is in their server list.

```sh
printf '{"email":"%s"}' owner@example.com |
  curl --fail -sS -X POST https://api.openbot.run/v2/admin/server-claims \
    -H @server-claims.header -H 'content-type: application/json' --data-binary @- |
  sed -n 's/.*"claim":"\([A-Za-z0-9_-]*\)".*/\1/p' |
  sudo openbot login --claim --name <name>
```

`server-claims.header` holds one line, `Authorization: Bearer <token>`, so the token is in no process
argument. `openbot login --claim` reads the claim from standard input, or asks for it without an echo
in a terminal, for the same reason.

- `POST /v2/admin/server-claims` needs the `SERVER_CLAIMS_ADMIN_TOKEN` of the account service. It
  makes the account of the email when there is none, and answers `{"claim", "expiresAt"}`.
- The claim works once, for 15 minutes. The account service keeps only its hash.
- The server sends it to `POST /v2/server-claims/redeem` and gets a session of the owner. The owner
  is then the only owner of the server. The operator does not need the owner's email or password.
- A claim that was used, or that expired, gives `server_claim_invalid`. If the server did not get the
  answer, make a new claim.

Anyone with the admin token can get a session for any email, also of an existing account. Keep the
token on the operator's computer only. The owner sees each claimed server session in their account
sessions, and can revoke it there.

Install options go after `sudo bash -s --`:

| Option | Default | Use |
| --- | --- | --- |
| `--user <name>` | the installed user, else `openbot` | The user that runs OpenBot and its agents. The install makes it when it does not exist, with its home folder in `/var/lib/<name>`. |
| `--auth-api-url <origin>` | the installed one, else the URL in the build | Another account server, for example the `test` Worker or a [self-hosted account service](self-hosting.md). |
| `--display-size <W>x<H>` | the installed one, else `1280x800` | The size of the virtual display that computer use reads (see [Display size](#display-size)). |

Run the install again to reinstall or upgrade. The data stays in the home folder of the service
user. A reinstall keeps the user and the account server, because the sign-in belongs to them, and
refuses another `--user`. A reinstall without `--display-size` keeps the display size. The install refuses an older release than the installed one, because an older OpenBot cannot
open a database that a newer one migrated. It also refuses a computer that is a hosted server.

## Commands

| Command | Use |
| --- | --- |
| `openbot status` | Show the version, the account, the server state, the memory and a staged update. |
| `openbot login [<email>] [--name <name>]` | Sign in with an email code. |
| `openbot login --claim [--name <name>]` | Sign in with an operator's one-time claim (see [Sign in with a server claim](#sign-in-with-a-server-claim)). |
| `openbot mobile-connect` | Show a Mobile Connect QR code for the phone app (see [Phone app](#phone-app)). |
| `openbot logout` | Sign out. The server is not available until the next sign-in. |
| `openbot name <name>` | Change the server name. |
| `openbot logs [-f]` | Show the journal of `openbot.service`. |
| `sudo openbot start\|stop\|restart` | Control `openbot.service`. |
| `sudo openbot update` | Download, check and install the newest release now. |
| `sudo openbot uninstall` | Sign out and remove OpenBot. The data stays (see [Remove](#remove)). |
| `openbot version` | Show the installed version. |

Run the account commands with `sudo` or as the service user. Other users cannot open the control
socket.

## Memory

A self-hosted server uses the memory guards of a hosted server (see
[Memory](hosted-servers.md#memory)). When free memory is low, new turns wait in the queue and start
again when memory is available. A message from a person starts first. The browser opens no new tab
and unloads idle pages sooner. A fixed number of turns run at the same time: 2 up to 5 GiB of memory,
8 up to 10 GiB, and 16 above.

The memory ceiling is the smaller of the machine memory and the limit of `openbot.service`
(`MemoryMax=90%`). To give OpenBot less memory, lower the limit with
`sudo systemctl edit openbot.service`, for example `MemoryMax=2G`, and restart the service. The
turn limit and the low-memory levels then use the new ceiling. `openbot status` shows the ceiling,
the free memory, the level (`ok`, `low` or `critical`) and the turn limit:

```text
Memory: 1228 MiB free of 3481 MiB (ok)
Turns at the same time: at most 2
```

The guard reads cgroup v2. On a system with cgroup v1, it uses the machine memory and the log has
one warning.

Agent processes run at nice 10 with an OOM value of 500, also a job that an agent detaches. At the
`critical` level, OpenBot stops leftover agent processes first. Node programs of agents see the CPU
limit of the unit in `os.cpus()`. See [agent processes](hosted-servers.md#memory).

## Display size

A self-hosted server gives the agents a virtual display (Xvfb), and computer use reads that display.
The default size is 1280x800. A [Docker](docker.md#environment) container uses the same setting
and the same default. A hosted server gives the agents its boat desktop, and this setting does not
change that desktop.

The display size does not change the OpenBot browser (`openbot_browser`). Its pages have their own
size, 1200x800 when no panel shows them, and its clicks go to page elements.

To use another size, give it at the install with `--display-size 1920x1080`, or write this line in
`/opt/OpenBot/hosted/openbot.env` and run `sudo openbot restart`:

```text
OPENBOT_DISPLAY_SIZE=1920x1080
```

The value is `WIDTHxHEIGHT` in digits, from 640x480 to 2576x2576. The install refuses a value that is
not valid. At a start, a value that is not valid writes this warning in `openbot logs`, and the
server starts with 1280x800:

```text
OPENBOT_DISPLAY_SIZE is not WIDTHxHEIGHT from 640x480 to 2576x2576. The display is 1280x800.
```

### Which size to use

Keep 1280x800 unless the apps that agents use need more space. At 1280x800, computer use clicks
more accurately, and a screenshot costs fewer tokens. Use 1920x1080 only with a model that reads a
1920x1080 image at its full size (see [Screenshots and clicks](#screenshots-and-clicks)).

A click test compared the two sizes. A model clicked a 26x17 px button in an `xmessage` window that
almost filled the display, once from a full-display screenshot and once from a window screenshot.
The models were the free OpenCode models with image input (OpenCode 1.18.30, Docker image 0.42.0,
arm64):

| Model | 1920x1080, full display | 1920x1080, window | 1280x800, full display | 1280x800, window |
| --- | --- | --- | --- | --- |
| MiMo v2.6 Flash | Hit | Miss | Hit | Hit |
| DeepSeek v4.1 Flash | Miss | Miss | Hit | Hit |
| GLM 5.3 Flash | Hit | Miss | Hit | Not tested (429) |
| LongCat 2.5 Preview | Miss | Miss | Hit | Hit |
| Muse Spark 1.3 | Miss | Miss | Miss | Hit |
| Nemotron 3.5 Super VL | Miss | Miss | Hit | Hit |
| Space Bunny | Hit | Hit | Hit | Hit |
| **Hits** | **3 of 7** | **1 of 7** | **6 of 7** | **6 of 6** |

Claude and Codex models were not in the test.

An image costs `⌈width / 28⌉ × ⌈height / 28⌉` visual tokens on Claude. A full-display screenshot at
1920x1080 costs about 2 times the tokens of one at 1280x800:

| Display size | Visual tokens of one full-display screenshot |
| --- | --- |
| 1280x720 | 1196 |
| 1280x800 | 1334 |
| 1366x768 | 1372 |
| 1920x1080 | 2691 |
| 2560x1440 | 4784 |

### Screenshots and clicks

The computer use driver (cua-driver, `cua-driver-rs-v0.34.0`) has two screenshots on Linux:

- **One window** (`get_window_state`). The driver makes the image 1.15 megapixels or less, with a long
  edge of 1568 px or less, and changes the x and y of each click back to screen pixels. A 1260x780
  window gets to the model at its full size. A 1900x1060 window gets to the model at 1435x801. Then
  small controls are harder to hit, and some models send the x and y in screen pixels, so the click
  lands outside the control. A window that goes past the edge of the display gives no screenshot.
- **The full display** (`get_desktop_state`). The driver sends the image at its full size and uses
  the x and y of a click as screen pixels. The clicks land correctly only when the model reads the
  image at its full size.

What a model reads of a full-display screenshot at 1920x1080:

| Provider | Image |
| --- | --- |
| Claude 4.7 and later, all Claude 5 models | Full size, up to 2576 px on the long edge and 4784 visual tokens ([Vision](https://platform.claude.com/docs/en/build-with-claude/vision#resolution-and-token-cost)) |
| Codex | Full size: the limit is 2048 px and 2,500 tiles of 32x32 px, and 1920x1080 is 2,040 tiles |
| Grok, Gemini, OpenCode, Cursor, Cline, Pi | Not known |

A 1280x800 screenshot is not made smaller by any Claude or Codex model.

## Phone app

The phone app has no email sign-in. It signs in with a Mobile Connect code. A server has no screen
for the code, so `openbot mobile-connect` shows it in the terminal:

1. Sign in the server with `openbot login`.
2. Run `openbot mobile-connect`. In a container, run `docker exec -it <container> openbot mobile-connect`.
3. In the phone app, select **Scan QR code** and scan the code in the terminal.

The code signs the phone in to the account of the server. It works for one sign-in and expires after
two minutes. The phone then shows all servers of the account, and it opens this server first. The
phone connects through the account server and Signal, as the desktop app does. The server publishes
no port.

If the phone app is already connected to the same account from the desktop app, the server is
already in its server list. Remove a phone from the account in the desktop app, in
**Settings > Mobile Connect**.

## Remove

`sudo openbot uninstall` signs out, then removes the service, the units, the AppArmor profile, the
`openbot` command and the server files in `/opt/OpenBot`. It keeps the home folder of the service user
and the keyring in `/srv/openbot-hosted`. The keyring has the key of the encrypted data in that home
folder, so keep or delete the two together. An install with the same `--user` uses them again. To
delete the data too:

```sh
sudo userdel --remove openbot && sudo rm -rf /srv/openbot-hosted
```

The server stays in the server list of the account, offline. Remove it there.

## How it works

`install-server.sh` only downloads the release. It reads `latest-linux.yml`
(`latest-linux-arm64.yml` on arm64) of the latest GitHub release, checks the SHA-512 of the
AppImage, unpacks it and runs `resources/hosting/openbot-server-setup` from that release. So the
install steps always match the build that they install. A release before this feature has no setup
file, and the install stops with a message.

`openbot-server-setup` uses the install steps of a hosted server (`openbot-hosted-update`): it
installs the packages in `packages.txt`, copies the release to `/opt/OpenBot/app`, and installs the
scripts, the AppArmor profile and the units. It writes `self` to `/opt/OpenBot/hosted/mode` and
links `/usr/local/bin/openbot`.

With `mode` set to `self`, `openbot-hosted-server` does not wait for a claim or for a boat desktop.
It starts a D-Bus session with an unlocked keyring, as on a hosted server, and runs OpenBot under
Xvfb with `OPENBOT_SERVER=1`. Main (`src/main/server-mode.ts`) then opens the control socket
`/run/openbot/control.sock` and publishes the host after each sign-in.

The server has two Xvfb displays, one in each of two nested `xvfb-run` commands that share one
authority file. The outer one starts the agent display, at the [display size](#display-size), and
the script names it in `OPENBOT_AGENT_DISPLAY`. The inner one starts the display that OpenBot shows
its windows on, at 1280x800. Main gives that display to Computer Use, to remote desktop and to the agent
processes, so an agent's screenshot and remote desktop do not show the OpenBot window. See
[Computer Use and remote desktop](architecture/computer-use.md#agent-display-on-a-server).

Updates work as on a hosted server (see [Updates](hosted-servers.md#updates)): the timer stages a
new release, and it starts at the next boot, or when an owner, an admin or a permitted member
installs it in Server Settings > Updates. `sudo openbot update` stages, stops the service, applies
and starts the service again. When a step fails or a signal stops it, the command completes an
interrupted copy, starts the service, and exits with an error.

## Control socket

The `openbot` command talks to main over HTTP on a Unix socket, with form bodies and `key=value`
text answers, so it needs only `curl`. The routes are `GET /v1/status`, `POST /v1/login/start`,
`POST /v1/login/verify`, `POST /v1/login/claim`, `POST /v1/name`, `POST /v1/mobile-connect` and
`POST /v1/logout`.

Threat model:

- systemd makes `/run/openbot` for the service user with mode 0700, and main makes the socket 0600.
  Main refuses to listen when the directory belongs to another user or other users can enter it. It
  never removes a file at the socket path that is not a socket.
- Only the service user and root can connect. Agents run as the service user and already have full
  access to its files, its keyring and the OpenBot database, so the socket gives them nothing new.
- The socket answers a closed list of requests. It never sends the session token, the sign-in
  code or the claim back, and a value cannot add a line to an answer. A body is at most 4 KiB.
- Server mode starts only in a packaged Linux build with `OPENBOT_SERVER=1`, and never on a hosted
  server, which signs in with its claim.

## Not confirmed

- The full install runs only on Ubuntu 24.04 in tests. On Debian 12 and Debian 13, only the package
  step is tested (`apt-get --dry-run`). Debian 12 names some libraries without the `t64` suffix, and
  the install uses those names.
- Ubuntu 26.04: release 0.48.1 was tested on Ubuntu 26.04.1 arm64 in the Docker image, with
  `BASE=ubuntu:26.04` and the package list without `libminiupnpc17` (the 0.48.1 list stops that
  build). The server started with the Electron sandbox on, `openbot status` answered, and it stopped
  with exit code 0. The install with systemd and a native x86_64 run were not tested.
- Remote desktop on Ubuntu 26.04: the runtime build checks with `ldd` that the x86_64 runtime finds
  all its libraries there (see [Linux runtime](RELEASING.md#linux-runtime-recipe-16)). In the x86_64
  Docker image under emulation, Sunshine and Moonlight Web started. A streamed remote desktop
  session on Ubuntu 26.04 was not tested.
- The full install was not run on a Linux computer before the first release that has the setup
  file. It needs a release build.
- [Display size](#display-size): the display sizes, the warning and the start with a value that is
  not valid were tested in the Docker image. An install with `--display-size` was not run. The click
  test ran only on arm64, with one `xmessage` button and one run for each model, size and screenshot.
  Claude and Codex were not in it. A window past the edge of the display was tested only with
  `xmessage`. The window screenshot limits come from the cua-driver source
  (`platform-linux/src/tools/impl_.rs`, `get_window_state` and `get_desktop_state`), and the Claude
  limits from the Claude docs. The Codex limit comes from `codex-rs/utils/image` and was not checked
  again. It is not known if Claude Code or Codex makes a screenshot smaller before it sends it to
  the model.
- The two displays were tested in an Ubuntu 24.04 container with a stand-in for OpenBot: OpenBot
  gets 1280x800, the agent display the display size, and a process without the authority file cannot
  open the agent display. Computer Use and remote desktop on the agent display were not tested on a
  server.
