# OpenBot

[![CI](https://github.com/nightly-labs/openbot/actions/workflows/ci.yml/badge.svg)](https://github.com/nightly-labs/openbot/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-PolyForm_Noncommercial_1.0.0-blue.svg)](LICENSE)

OpenBot is a local-first desktop workspace for persistent AI teammates. It supports the local
[Codex App Server](https://learn.chatgpt.com/docs/app-server) and
[Claude Code](https://code.claude.com/docs/en/overview), plus [Grok CLI](https://docs.x.ai/build/overview)
through ACP. It gives every agent its own workspace and
conversation, and provides local queues, file transfers, an embedded browser, and agent-to-agent
messaging in one desktop app.

> [!WARNING]
> OpenBot is a development preview. Agents currently run with `danger-full-access` and
> `approvalPolicy: never`. They can read and modify files, run commands, use the network, and control
> the embedded browser without per-action confirmations after the explicit first-launch consent.
> Run only agents and tasks you trust, keep backups, and review [Security](#security) before use.

## What works

- Prompt-driven agent creation and editing on desktop and mobile, with editable instructions, avatar, and section review before saving.
- Persistent agents backed by independent Codex, Claude, Grok, or OpenCode sessions and local workspaces.
- Per-agent context monitoring with automatic compaction before long threads exhaust the model window.
- FIFO message queues with pause, resume, cancellation, and crash-safe persistence.
- Agent-to-agent messages, replies, reactions, images, and managed file transfers.
- Shared desktop channel chats with one task owner, explicit delegation, shared history, and Stop, Resume, Reassign, Archive, and Restore controls.
- A persistent embedded browser that agents can open, inspect, and control.
- Optional Computer Use on macOS, Windows and Linux through the `cua-driver` binary in the release, which OpenBot starts as its own child process and gives to every provider.
- Per-agent model, reasoning, profile, notification, browser, and panel state.
- Local data and privacy-safe diagnostics exports from the account menu.
- Optional OpenBot accounts through one-time email codes. The account API runs on Cloudflare Workers and D1.

OpenBot is local-first, not offline-only. Codex connects to OpenAI, Claude connects to Anthropic,
Grok connects to xAI,
visited pages use the network, and installed plugins may connect to their own services.

## Install

OpenBot supports macOS 13 or newer on Apple Silicon, Windows 10 or newer on x64 systems, and x64
or arm64 Linux as an AppImage.

### macOS

1. Download the latest `OpenBot-*.dmg` from [GitHub Releases](https://github.com/nightly-labs/openbot/releases).
2. Drag OpenBot to Applications and open it.

### Windows

1. Download the latest `OpenBot-*-x64.exe` from [GitHub Releases](https://github.com/nightly-labs/openbot/releases).
2. Run the installer and open OpenBot.

### Linux

1. Download the latest `OpenBot-*-x86_64.AppImage` (or `OpenBot-*-arm64.AppImage` on arm64) from [GitHub Releases](https://github.com/nightly-labs/openbot/releases).
2. Make it executable with `chmod +x OpenBot-*.AppImage`, then run it.

On Ubuntu 23.10 or newer and on Debian 13, unprivileged user namespaces are restricted by AppArmor
and OpenBot exits during launch until you install an AppArmor profile:

```bash
sudo install -m 0644 build/linux/openbot.apparmor /etc/apparmor.d/openbot
sudo systemctl reload apparmor
```

The same file ships inside the AppImage at `resources/linux/openbot.apparmor`. Edit the attachment
path in the profile if you keep the AppImage outside the usual locations. Do not start OpenBot with
`--no-sandbox`: that removes the boundary between a renderer and the rest of the computer.

On the first start from an AppImage, OpenBot writes `~/.local/share/applications/openbot.desktop`
and `~/.local/share/icons/openbot.png`, which is what lets an `openbot://` link - an invitation, or
a plugin listing - open the app and gives the launcher an icon that stays after the app exits. Delete the two files to undo it.

Voice prompts and remote desktop are not available on Linux.

> [!IMPORTANT]
> The Windows preview is not code-signed. Windows can show an `Unknown publisher` or SmartScreen
> warning. Check the release checksum or GitHub build attestation before you run the installer.

### Agent setup

OpenBot can download a supported provider runtime when you select `Download` in onboarding,
Settings, agent setup, or the model picker. OpenBot prefers its managed CLI. Explicit `OPENBOT_*_PATH` overrides take precedence; a compatible
system CLI is used when no managed copy is available. OpenBot checks for a newer provider CLI
release at startup and every hour, and `Check for updates` in a provider's actions menu checks at
once. Updates install the latest upstream release without changing the user’s system CLI; the
version in `native-runtime.lock.json` is only the first-install fallback.

You can also install a CLI yourself.

Codex CLI on macOS:

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
```

Claude CLI on macOS:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Install Grok CLI following the [Grok Build documentation](https://docs.x.ai/build/overview), then
authenticate with `grok login` or set `XAI_API_KEY` in the environment used to launch OpenBot.

OpenBot downloads and pins the OpenCode CLI, like Codex, Claude, and Grok. OpenCode's free models
need no account and no sign-in: select OpenCode, click Connect, and OpenBot reads the models that
the CLI advertises. To use the paid OpenCode Go models, click Sign in on the OpenCode row and
paste a Go key from [opencode.ai/auth](https://opencode.ai/auth). OpenBot encrypts the key on this
computer and gives it only to the local CLI. OpenBot supports OpenCode Go only: the Zen models a
Go key does not buy stay out of the picker. If you installed OpenCode yourself, OpenBot
keeps that install and offers no download. Set `OPENBOT_OPENCODE_PATH` to select an executable
outside your shell's search path. Remote OpenCode agents require Team API v4; older clients do not
show these agents.

On Windows, install the native CLI and make sure `codex`, `claude`, or `grok` is available in PowerShell.
Claude Code also requires Git for Windows. Then authenticate the installed CLI and restart OpenBot.

Bun and Node.js are not required when using an installed release. Optional Computer Use works on
macOS, Windows and Linux, and the release carries the driver, so there is nothing to install. Only
macOS asks for a permission for it: Screen Recording and Accessibility.

OpenBot uses the existing local CLI login. It does not copy provider credentials. Grok's
`XAI_API_KEY` and per-session MCP bearer tokens are never persisted or logged.

For setup problems, data reset, and uninstall instructions, see
[Troubleshooting](docs/TROUBLESHOOTING.md). OpenBot's data and network behavior is documented in
[Privacy](PRIVACY.md).

## Development

Development requires stable [Bun](https://bun.sh/) 1.4.0, Node.js 24 (the version in `.nvmrc`, matching
the Node that Electron bundles - run `nvm use`), and at least one supported agent CLI.

Install the exact Bun version on macOS or Linux:

```bash
curl -fsSL https://bun.com/install | bash -s "bun-v1.4.0"
```

Install it on Windows in PowerShell:

```powershell
iex "& {$(irm https://bun.com/install.ps1)} -Version 1.4.0"
```

```bash
git clone https://github.com/nightly-labs/openbot.git
cd openbot
bun install --frozen-lockfile
bun run codex:doctor
bun run dev
```

`codex:doctor` checks the CLI version, App Server handshake, and ChatGPT login without starting a
model turn. `bun run cua-driver:doctor` reports the Computer Use driver separately.

In a new git worktree, run `bun run dev:bootstrap`. It copies the files that `.worktreeinclude`
lists from the main checkout when they are missing, installs dependencies, migrates the local API,
and seeds the isolated profile. Set it as the worktree setup command of your agent harness.

To reset only the local development state, quit the dev app and test client, then run
`bun run dev:reset`.
The command deletes the app and test-client development profiles plus the legacy host profile,
including `openbot.db` and its WAL files. It does not change the production profile, agent
workspaces, `~/.codex`, or `~/.claude`.

`bun run dev` seeds a development profile it creates, so a first start already shows this data.
To replace a profile that exists, quit the dev app, then run:

```bash
bun run dev:seed
bun run dev
```

The seeded agents run on `opencode-go/muse-spark-1.3-contributor` at medium effort while this
computer's OpenCode CLI lists it, and on `gpt-5.6-luna` at low effort otherwise. A dev build starts a
new agent on the same pair, so a seeded agent and one you create agree; a packaged build always uses
`gpt-5.6-luna`.

The seed adds agents, rich conversations, managed files and references, reactions, completed
agent exchanges, two channels with a delegated task run, channel memories and routines, and local
team chat data. It dates every record backwards from the run, so the transcripts read Today and
Yesterday. It does not add live queue items, open routine runs, or queued channel tasks, so it
starts no model turn.
Use `bun run dev:seed --dry-run` to inspect the target and fixture counts without changing files.

### Marketplace launch catalog

Seed the approved OpenBot team catalog locally with `bun run marketplace:seed:local`, then start or reuse `bun run dev --isolated`. Search **OpenBot** in Marketplace to review its Skills and Agents. This seed adds catalog records without resetting app data.

`bun run marketplace:build` creates the launch bundles. `bun run marketplace:publish:production` is a dry run; production writes require explicit flags and admin credentials. See the [catalog and publication guide](marketplace/production-catalog/README.md).

Skill authors can add optional `example-prompt` text to the YAML frontmatter in `SKILL.md`:

```yaml
example-prompt: Turn the latest commits into release notes.
```

The skill preview shows this text. **Try skill** appends it and a skill reference to the selected agent's draft. It does not send the message. The field accepts up to 1,000 characters after trimming. Missing or invalid values use a default example. No new package format or database migration is required.

## Local skills

Ask an agent to create a skill from a reusable workflow. It prepares a folder with `SKILL.md` and calls `create_skill`. The skill is saved in a shared local library and enabled for that agent. No account is required. Other agents can add it through **Settings → Skills → Local skills**.

Agents can use `list_local_skills`, `read_local_skill`, `revise_skill`, and `install_local_skill`. Revisions require the version read by the agent and retain previous versions. Updating a library skill does not update installed copies: use the Update chip or install an exact revision. Modified installed files are protected. To publish a local skill, submit its folder separately through the marketplace.

Optional scripts, references, and assets follow the Codex skill folder structure. A PNG at `assets/icon.png` supplies the local preview logo. The built-in `openbot-skill-creator` guide explains the format and validation limits. Registration does not run scripts.

## Import agents from Grok Bot

Open **Server settings → Import** on this computer. Add the [OpenBot export agent](https://x.ai/bot/gI0XdhhDYPJeyQaqQBC0O) to Grok Bot and say "Export my agents for OpenBot". It saves one `.zip` file to Downloads. Choose that file in OpenBot, select the agents, and import them.

The import adds each agent's name, instructions, avatar, skills, routines, and memories. Workspace files are copied to `imported/` in the agent's workspace if you included them. Chat history is not copied: the export agent keeps the important facts as memories. The file is read on this computer and is not uploaded. The export skill and its format are in [`resources/agent-import/grok-bot/SKILL.md`](resources/agent-import/grok-bot/SKILL.md).

## Commands

The browser client is served at `/app` by the public web app. For local development, run
`bun run dev:api --isolated` and open `/app` on the API URL printed by the supervisor. Use
`bun run dev --isolated` when a desktop host is also needed.
Use `bun run storybook` and **Web → Workspace → Connected** for shared UI test data.
See [web client delivery](docs/web-client.md) for the release gate and focused checks.

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start the local Auth API, Signal service, and Electron client with renderer HMR on its app profile. Ports are allocated through the dev registry, so a sibling worktree never takes one this stack won. It refuses a second stack in the same worktree unless you pass `--force`, and `--isolated` gives the worktree a profile of its own keyed to its path instead of the shared `OpenBot Dev` one. A profile that does not exist yet is seeded with the showcase data of `bun run dev:seed` before the client starts, so a first start never opens an empty app; an existing profile is left as it is. An isolated profile still shares the computer's provider CLI store, so it does not download the pinned CLIs again. |
| `bun run preview` | Preview the built Electron client with the green preview icon. |
| `bun run mobile:go` | Start the mobile app in Expo Go and clear the Metro cache. |
| `bun mobile:ios` | Build and launch the iOS simulator app without RocketSim. |
| `bun run dev:mobile` | Start or reuse this worktree's `bun run dev` stack, build and launch the iOS simulator app, and pair them without a QR scan. The desktop issues a Mobile Connect ticket over CDP, and `simctl openurl` opens the link in the development build, which accepts only loopback or private-network account services. Other arguments go to `bun mobile:ios`. `--pair-only` pairs an app that already runs; `--simulator=<udid>` chooses one of several booted simulators. It stops when the Metro port is already in use, because another worktree's Metro would serve the same app id; pass `--port=<n>` then. |
| `bun run mobile:ios:build:local` | Build a production iOS `.ipa` locally for upload with Transporter. See [TestFlight setup](apps/mobile/README.md#local-testflight-build). |
| `bun run mobile:ios:release:testflight` | Start the GitHub Actions iOS build from `main` and upload to TestFlight. Requires authenticated GitHub CLI. See [iOS release setup](apps/mobile/README.md#github-actions-testflight-release). |
| `bun mobile:ios:rocketsim` | Start RocketSim and build and launch the iOS simulator app with RocketSim Connect. See [mobile setup](apps/mobile/README.md#development). |
| `bun run mobile:go:tunnel` | Start the mobile app in Expo Go through a Metro tunnel and clear the cache. The OpenBot API and Signal still need their own reachable addresses. |
| `bun run dev:api` | Start the TanStack Start API and its local D1 database on `127.0.0.1:3100`. |
| `bun run api:start` | Build and preview the Cloudflare Worker locally. |
| `bun run api:images` | Draw the article artwork into `apps/auth-api/content-art/` after you add an article or change a title. Commit the result; the site build fails until it matches. Needs Electron and a GPU, so run it on your own machine. |
| `bun run api:migrate:local` | Apply D1 migrations to the local development database. |
| `bun run api:migrate:remote` | Apply D1 migrations to the configured remote database. |
| `bun run api:deploy` | Build and deploy the account API to Cloudflare Workers. |
| `bun run remote:up` | Build and start the self-hosted Signal, coturn, and ACME stack. |
| `bun run remote:check` | Check the Remote API and both Docker Compose configurations. |
| `bun run remote:check:compose` | Validate both Docker Compose configurations alone, without a running daemon. |
| `bun run remote:update` | Update Signal, then drain and update the single coturn instance. |
| `bun run dev:all` | Start the Auth API, Signal service, and single local Electron instance. |
| `bun run dev:test-client` | Start the Auth API, Signal service, local instance, and an isolated second client for team testing. |
| `bun run dev:seed` | Replace only the app development profile with durable showcase data. `--if-missing` keeps an existing profile, which is how `bun run dev` seeds a first start. |
| `bun run dev:reset` | Delete the local app, test-client, and legacy host development state. |
| `bun run dev:status` | Print, as JSON, every dev stack and dev app instance live on this machine: services, ports, pids, which of them belong to this worktree, and which are orphaned - a supervisor that is gone with its children still holding the ports. Each recorded process carries the state a stop command acts on: `live`, `gone` with `groupLive` for a survivor of a dead leader, and `unverified` for a pid this machine cannot date. |
| `bun run dev:verify` | Print a stable JSON verification plan for this worktree: `ready`/`reasons` for safe checks, setup state, changed files and affected surfaces, nearby tests, runtime state, `qa.required`/`qa.ready`/`qa.reasons`, the renderer QA loop, safe `runnableCommands`, and all suggested `commands`. Add `--run` to execute only the safe non-mutating checks in the plan. Renderer QA follows `snapshot → action with --wait-for → snapshot → screenshot` when appearance matters. |
| `bun run dev:stop` | Stop this worktree's dev stack, children included, using the pids in the registry rather than a process-name pattern. It signals only a pid whose start time still matches the record, so a recycled pid is never sent SIGTERM; anything it cannot confirm is reported, left running and kept in the registry, and the command exits non-zero. `--pid=<supervisor pid>` stops one other stack, `--all` stops every stack on the machine. |
| `bun run dev:forget` | Drop this worktree's stack record without signalling anything, for the one case `dev:stop` refuses to resolve on its own. It is also the only command that reads a dead record: nothing else deletes one, because a reader that removes what it judged can remove a record the supervisor rewrote in between. Takes the same `--pid=` and `--all`. |
| `bun run storybook` | Start Storybook on a port allocated through the same registry, so two worktrees never announce one port. `OPENBOT_STORYBOOK_PORT` moves where the search starts; `--port` is refused. |
| `bun run build-storybook` | Build static Storybook. CI sets `OPENBOT_STORYBOOK_CHECK=true` to skip automatic prop documentation during its build check. |
| `bun run dev:automation` | Drive the running dev app over CDP: `instances`, `pages`, `snapshot`, `screenshot`, `click`/`type` by accessible role. `--page=<target-id\|url-substring>` aims at any window, including embedded browser views; `--wait-for=<role>,<name>` settles on an accessible target instead of polling; mutations need `--allow-mutations` and a named instance (this worktree's record, `--instance=<id>` or `--port=`). |
| `bun run dev:cpu` | Measure idle CPU on the running dev app, per process kind and per page. `--duration=<ms>` (default 60000), `--interval=<ms>` (default 5000), `--label=<name>`, `--out=<name>.json` (always under `.openbot-build/dev-automation/cpu/`, and refused if it would leave that directory or pass through a symbolic link) and `--compare=<file>` for a before/after delta. Read-only. Take a baseline before a change and a second run after it: only the difference between two runs on the same machine is a result, because a dev build carries the Vite server and the source maps as well. |
| `bun run dev:memory` | Measure the running dev app's memory once: resident memory per process kind (main, renderer, GPU, provider CLIs and their MCP servers), with the dev tooling kept out of the app total, plus JS heap and DOM counters per page. `--label=<name>`, `--out=<name>.json` (always under `.openbot-build/dev-automation/memory/`) and `--heap-snapshot=<target-id\|url-substring>` to also write a V8 heap snapshot of one page to that directory. Read-only. |
| `bun run check` | Run Biome, both typechecks, offline tests, the browser smoke test, and the production build. |
| `bun run typecheck` | Check all 12 projects in parallel with a separate incremental cache for each project in this worktree. |
| `bun run check:ui` | Check the renderer against the design system: shared primitives, Kobalte and Lucide confined to `@openbot/ui`, palette tokens instead of colour, size, radius and transition literals. Checks renderer and shared UI source. |
| `bun run test:backend` | Run backend tests only. |
| `bun run test:browser` | Run the complete local embedded-browser smoke test, including cross-process persistence. Use `--scenario=controls`, `--scenario=tool-boundary`, `--scenario=evaluation`, `--scenario=wait-deadlines`, or `--scenario=popups` for one isolated scenario. |
| `bun run test:codex` | Probe the real CLI handshake and account without starting a paid turn. |
| `bun run test:durations` | Re-record how long each desktop test file takes. CI splits its shards by this table, so run it when the two shards stop finishing together. |
| `bun run cua-driver:doctor` | Print, as JSON, which `cua-driver` binary OpenBot would use for Computer Use, and the driver's own `doctor` report. Read-only, and it starts no daemon. `OPENBOT_CUA_DRIVER_PATH` selects a different binary in a checkout; an installed application runs only the driver it was released with. |
| `bun run prepare:cua-driver` | Write the pinned Computer Use driver to `build/cua-driver/<platform>/<arch>`, verifying every SHA-256 in `native-runtime.lock.json`. Name another target with `bun scripts/install-cua-driver.ts <platform> <arch>`. Every packaging command runs this first. |
| `bun run pin:cua-driver <version>` | Print a new `cuaDriver` block for `native-runtime.lock.json` from a published `cua-driver` release. Downloads all three targets and hashes each shipped file. |
| `bun run package` | Build an unpacked local ARM64 application. |
| `bun run package:verify` | Build and verify the real ARM64 app bundle, icon, metadata, ASAR, and fuses. |
| `bun run package:win` | Build an unpacked local Windows x64 application on Windows. |
| `bun run package:win:verify` | Build and verify the Windows x64 application on Windows. |
| `bun run package:linux` | Build an unpacked local Linux x64 application on Linux. |
| `bun run package:linux:arm64` | Build an unpacked local Linux arm64 application on arm64 Linux. |
| `bun run package:linux:verify` | Build and verify the Linux x64 application on Linux. Run it under `xvfb-run -a` without a display. |
| `bun run release:preflight` | Verify version, Git state, and GitHub release secrets before tagging. |
| `bun run dist:mac` | Build unsigned local ARM64 DMG and ZIP update artifacts. |
| `bun run dist:win` | Build an unsigned Windows x64 NSIS installer on Windows. |
| `bun run dist:linux` | Build an unsigned Linux x64 AppImage on Linux. |
| `bun run dist:linux:arm64` | Build an unsigned Linux arm64 AppImage on arm64 Linux. |
| `bun run release:patch` | Create the next patch version commit and tag. |
| `bun run test:filesystem` | **Online/manual:** run real full-access Codex and Claude filesystem turns across private and shared workspaces. |
| `bun run test:imagegen` | **Online/manual:** run a real full-access image-generation turn. |
| `bun run test:storage-live` | **Online/manual:** verify isolated Codex and Claude turns in a temporary SQLite database. |

Publishing never creates a second OpenBot instance. The host keeps its Team API on loopback. A hidden,
sandboxed Electron page connects it to invited clients through WebRTC. Signal carries only connection
setup messages. Team data uses direct DataChannels when possible and the project coturn service when
direct ICE fails. Cloudflare stores accounts, configuration, memberships, invitations, logical session
records, and public assets. It does not carry chats, files, commands, or remote desktop media.

The development runner advertises both Mobile Connect and its Signal service on the preferred private
LAN interface. Restart the runner after changing networks so newly generated QR codes contain the
current address.

Production mobile analytics setup and required OpenPanel credentials are documented in
[OpenBot Mobile](apps/mobile/README.md#openpanel-product-analytics).

`mobile:go:tunnel` exposes only the Expo development server. It does not expose the local account
API, Signal, or TURN. A phone on 5G cannot use the default LAN addresses. For a test across networks,
use a VPN that connects both devices, or provide HTTPS and WSS endpoints that forward to this dev
stack's account API and Signal ports. Set `OPENBOT_MOBILE_AUTH_API_URL` to the reachable account API
origin and `REMOTE_SIGNAL_URL` to the reachable Signal URL, including `/v1/signal`, before starting
`bun run dev`. Use the ports reported by `bun run dev:status`; they can differ between worktrees.
If direct WebRTC cannot connect, `TURN_HOST` must name a reachable coturn service and
`TURN_SHARED_SECRET` must match that service. An HTTP tunnel cannot forward TURN traffic.
Generate and scan a new Mobile Connect code after changing the account API address; an existing
mobile session retains its original address.

Mobile sign-out removes the local login even when the account API is unavailable. The app keeps
only the credential in secure storage for revocation retries at startup, on return to the foreground,
and on the next connection attempt. Remote revocation completes when the account API is reachable.

For manual team testing, `bun run dev:test-client` starts a complete two-client harness. The second
client uses the isolated `OpenBot Dev Test Client` profile and renderer port 5174. `dev:reset` also
removes that profile and the legacy `OpenBot Dev Host` profile. It does not remove the downloaded
provider CLIs, which the whole computer shares. Press `Ctrl+C` in the runner terminal
to stop only the processes started by that runner, or run `bun run dev:stop` from the worktree once
that terminal is gone. Never stop a dev stack with `pkill -f electron` or `pkill -f bun`: on a
machine running several worktrees those kill the other checkouts' work mid-write, which is what
`dev:status` and `dev:stop` exist to make unnecessary.

Set `OPENBOT_DEV_ICE_TRANSPORT_POLICY=relay` before this command to force Team API traffic through
coturn. This test option works only with the development renderer. Production always starts with `all`.

The normal `check` command is offline and uses a fake App Server. Manual smoke scripts may use the
signed-in subscription and must not run in CI.

Local agents run with the providers' unrestricted execution modes. Each agent starts in its own
persistent `~/OpenBot/Agents/<agent-id>` workspace and also receives `~/OpenBot/Shared`; routine command
and filesystem work in both locations runs without OpenBot adding another permission boundary.
Because these modes are intentionally unrestricted, they also permit host access outside those
directories when the provider and operating system allow it.

### macOS remote desktop permissions

For each macOS account, log in to its GUI session and open **Server Settings → Remote desktop access**.
Select **Check again** to read Sunshine's Screen Recording and Accessibility permissions, display availability,
and GUI session status. The panel names the Mac and the account that runs Sunshine. Grant permissions in
that account, including when the account was created with the tenant setup script.

After you publish a server on a Mac, an optional **Set up remote desktop** prompt opens this panel. Select **Later** to keep using the published server without remote desktop setup.

Use the permission buttons to open **System Settings → Privacy & Security** on the host. If Sunshine is
missing from a list, select **Show Sunshine in Finder** and add the bundled `Sunshine.app` with the **+** button.
macOS can attribute access to the application that starts Sunshine; enable the application named by the
system prompt. Return to OpenBot to check again. If a restart is required, end remote sessions first.
A check never restarts an active session.

Select **Test on this Mac** for a local test. If native checks are unavailable, it tests video only and disables viewer input. After the checks pass, it can test mouse and keyboard too. Select **Test remote desktop** from another computer for a remote test.
The test requires an otherwise unused remote desktop host. It opens a temporary host panel, keeps remote
input inside that panel, and asks you to click a target and type a four-digit code. Confirm that the picture
is visible, then select **Finish test**. Local input does not pass the mouse or keyboard test. The panel
expires after two minutes. Older hosts or native runtimes require an update before these checks are available.

The native runtime source change invalidates prior artifact pins. The **Remote desktop runtime** CI workflow
builds and tests the new source, then publishes and pins verified artifacts through its existing release flow.
Do not reuse old artifact hashes with the new source digest.

## Architecture

```text
Electron main
├── local Codex App Server process over stdio JSONL
├── local Claude Agent SDK session over stream JSON
├── SQLite command log and read projections
├── secure typed IPC handlers
└── sandboxed WebContentsView browser host
    ↕ typed preload bridge
SolidJS renderer

Cloudflare Workers
└── TanStack Start + Solid 2 account API
    ├── D1 accounts, email challenges, hashed sessions, and team tunnels
    └── R2 account avatars
```

- `src/main` owns the Electron lifecycle, window security, local protocol, and IPC registration.
- `src/backend` owns provider adapters, persistence, message scheduling, transfers, and the browser host.
- `src/preload` exposes only the typed `window.openbot` API.
- `src/renderer` contains the SolidJS interface.
- `apps/auth-api` contains the TanStack Start account API, one-time email codes, rate limits, and D1 migrations. It also serves the public site: the landing page, `/news`, `/guides`, and the plugin pages at `/plugins` and `/plugins/<slug>`.
- `packages/contracts` contains process-boundary contracts, shared limits, and pure validation.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for dependency direction, state ownership, and
rules for new modules.

## Chat attachments

Attach MP3 audio and MOV video through the file picker or drag and drop. The limits are 100 MB per
file, 250 MB per message, and 10 files per message. OpenBot gives the agent the original file; it does
not play, decode, transcribe, or validate the recording during import. Damaged recordings can be
attached for inspection. Analysis depends on the tools available to the agent. For other audio or
video formats, export as MP3 or MOV, or attach a text transcript. Remote hosts must advertise the
`media-attachments` capability; update the host if this feature is unavailable.

## Local data and network boundaries

- `~/OpenBot/Agents/<agent-id>` — one working directory per agent. A profile written before the
  bot-to-agent rename holds them under `~/OpenBot/Bots`; the app moves them on first launch, and a
  workspace whose move could not run stays readable where it is.
- `~/OpenBot/Shared` — files intentionally shared between agents.
- `~/OpenBot/Shared/Transfers` — managed message snapshots and generated files. Each transfer has
  an `.openbot-transfer.json` manifest with ownership, recipients, size, and SHA-256 metadata.
- `~/OpenBot/Downloads` — embedded-browser downloads.
- Electron `userData/openbot.db` — the canonical OpenBot event log and projections for agents,
  conversations, provider session bindings, queues, reactions, and attachment indexes.
- Electron `userData/legacy-backup-v1` — unchanged copies of imported `bots.json` and
  `mailbox.json` files, when these files existed before the SQLite migration.
- `~/Library/Application Support/OpenBot/provider-runtimes` — the provider CLIs OpenBot downloads
  and pins. One store for the whole computer, outside any one profile, so every development profile
  and the packaged app read the same download. `--user-data-dir` keeps the store in that directory
  instead, so an explicitly named profile stays self-contained.
- `~/.codex` — login and thread history managed exclusively by Codex CLI.
- `~/.claude` — login and session history managed exclusively by Claude CLI.
- `~/.grok` — login and session history managed exclusively by Grok CLI.

Deleting an agent removes its workspace, owned generated attachments, and deliveries addressed only
to that agent. A transfer remains when another agent still uses the same message.

OpenBot keeps one stable local conversation when an agent changes between Codex, Grok, and Claude. Native
provider session identifiers stay private and are used only to resume provider runtime state.

The Electron renderer is never exposed as a public website. It communicates with local CLI processes
over stdio. When the owner publishes OpenBot, its authenticated Team API stays on localhost. WebRTC
protocol v3 carries RPC, events, and binary files to desktop and mobile clients. Expo Go hosts the
mobile `RTCPeerConnection` in a hidden Expo DOM component, so mobile uses the same encrypted transport
without a custom native development build. The account flow connects to
the configured HTTPS Cloudflare API. The client stores only an encrypted OpenBot session token. One-time codes expire after
10 minutes and are stored only as hashes. A daily maintenance task removes expired or consumed
authentication records from D1. The embedded browser uses a separate sandboxed Electron session and
cannot access `window.openbot` or managed local attachments.

## Security

Read [SECURITY.md](SECURITY.md) before reporting a vulnerability. Do not put credentials, private
files, conversation contents, or sensitive diagnostics in a public issue.

Full local access is an explicit current product decision, not a security boundary. Reports are
especially useful when remote content can reach Electron privileges, managed attachment paths can
escape their roots, IPC sender validation can be bypassed, or an agent can act outside the access
described above.

## Releases

Releases are tag-driven. `bun run release:patch`, `release:minor`, or `release:major` prepares the
version and changelog. After review, commit, preflight, and tag the release; pushing the tag builds a
signed and notarized macOS ARM64 release, an unsigned Windows x64 release, and unsigned Linux x64
and arm64 AppImages in GitHub Actions.
Installed builds check GitHub Releases for updates and expose download/restart controls in the account
popover. Release signing secrets and the complete procedure are documented in
[docs/RELEASING.md](docs/RELEASING.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). By contributing, you agree that your contribution is licensed
under PolyForm Noncommercial 1.0.0. Community behavior is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).

## License and attribution

Copyright 2026 Norbert Bodziony.

Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may use, modify, and
distribute the code for permitted noncommercial purposes. Commercial use requires a separate license
from the copyright owner. Versions up to and including 0.1.11 remain available under Apache-2.0.
See [NOTICE](NOTICE) for attribution and third-party notices.

OpenBot is an independent source-available project and is not affiliated with, endorsed by, or
sponsored by OpenAI. OpenAI, ChatGPT, and Codex are used only to describe compatibility with their
respective products and services.

### Shared macOS hosts

For one native Standard user per tenant, install the normal OpenBot DMG and the optional
`OpenBot-Host-<VERSION>-arm64.pkg` from the same release. The Host package provides
`sudo openbot-host setup --create-user client-acme --create-user client-bravo` and
`sudo openbot-host verify`. `sudo openbot-host status [--json]` and `sudo openbot-host watch`
show the update phase, the staged version, and each tenant's work state. No Git checkout, Bun,
or compilation is required on the host.
Normal desktop users need only the DMG. See the [host deployment guide](docs/multi-tenant-hosting.md)
for existing-user enrollment, password handling, package upgrades, and required target-host checks.
