# Roadmap: headless Bun server module (draft)

Status: **DRAFT — not a commitment, not merged upstream.** Companion to
`headless-server-mode-update-2026-11-21.md`. This file is research/planning only. It does
not change runtime behavior and requests no new permissions.

## Goal

A 100% headless, CLI-only OpenBot server: no Electron window, no Xvfb, no GUI stack, no
Chromium renderer. Started and managed from a terminal or a service unit, with the mobile
app or `openbot.run/app` as the only UI. Runtime preference: Bun (the repo already uses
Bun for dev scripts, tests and checks; Electron is used for the shipped build).

## Reference host (the case this is designed for)

- POCO X7 Pro / `rodin` — global model `2412DPC0AG`, sold in China as **Redmi Turbo 4**;
  Dimensity 8400-Ultra / MT6899, 8 cores, Mali-G720 MC7.
- Android 17 (SDK 37), build `CPH2873_17.0.0.110`, ColorOS 17 "TheLastBloom" (port by
  @NEESCHAL_3), kernel `6.6.142-EVONIX-COS-O+-V4.5`; KernelSU Next v3.4.2 + SUSFS.
- 10 GiB RAM visible in the chroot (12 GB marketed), 480 GB UFS; zram 12 GiB lz4
  priority 100, no writeback device; `MemAvailable` 1.5 GiB before zram,
  3.4-3.7 GiB after.
- **Real chroot**, not proot: Arch Linux ARM at `/data/arch` (f2fs), started from
  Android's init via a KernelSU `service.d` script. Agent shell is uid 2000 (`deivi`)
  with `CapEff=0`; root is on the Android side via `su -c`. OpenBot runs as
  `OPENBOT_SERVER=1` under two Xvfb displays (`xvfb-run` + `OPENBOT_AGENT_DISPLAY`).
- Packaged arm64 build of 0.75.0. Native Termux would be heavier: it adds a resident shell
  and its own runtime on top of the server.

## Why now (measured)

- Renderer patch on the same host: app tree p50 571 MB -> 359 MB (-212 MB, -37%);
  window renderer 232 MB -> 73 MB; one Chromium process less. CPU win small at idle
  (~1% of one core), the win is memory. PR #13808 / issue #13807.
- With zram configured, `MemAvailable` 1.52 -> 3.41-3.7 GiB, zram 12 GiB at ~3.3:1,
  11 agents ready, zero queued, no lag reported. The host-level RAM collapse is gone,
  so the app-level avoidable cost is the next thing worth removing.

## Phases (order subject to feasibility review by the research agents)

1. **Confirm boundaries** — map exactly what Electron main provides to a server host:
   control socket, setup page, host service, account login, ACP registry, agent database
   host process, team API, provider runtime supervision, shutdown semantics. Identify
   which entry points are already Bun-compatible and which are Electron-only.
2. **Reuse before rewriting** — the repo already ships a CLI over `control.sock`
   (`openbot status/login/mobile-connect/start/stop/restart/update`) and a hosted-server
   wrapper. Determine if a thin Bun CLI can drive the existing hosted server without
   reimplementing agent logic, as the first reachable milestone.
3. **Prototype: Bun launcher, no Electron UI** — keep the existing main process and
   provider runtime, replace only the packaged Electron entry with a Bun launcher that
   sets `OPENBOT_SERVER=1`, skips `loadRenderer` (already in PR #13808), and exposes the
   same control/team API surface. Validate on the reference host.
4. **Evaluate a true Bun main process** — only if step 3 proves the surface is small
   enough. Inventory what must be reimplemented: IPC contracts, account/Cloudflare
   client, ACP registry, SQLite host, Effect service graph, secret redaction. Respect
   the non-negotiable rules in root `AGENTS.md`: migrations, team API support window,
   renderer-to-main trust boundary, PolyForm Noncommercial 1.0.0.
5. **Upstream or stay in fork** — the mainline may ship headless first (#6350). Track
   it; if upstream lands, rebase and drop local patches. If not, keep the module in
   this fork as an additive package, with a clear statement of what needs a maintainer.

## Findings from the fork/landscape scan (2026-11-21)

- **No fork of `nightly-labs/openbot` implementing real headless was found.** Of 930
  forks, the active ones are mirrors. GitHub code search does not index forks, so this
  is "not found in the searches made", not absolute proof.
- **Mainline position:** issue #1547 — *"A headless server build without Electron is not
  planned at the moment. We may consider it in the future, when the project is more
  mature."* PR #1097 (`OPENBOT_HEADLESS=1`) was closed unmerged on 2026-10-17 with
  *"OpenBot now has a supported self-hosted Linux server … so I'm closing this PR."*
  Issue #6350 (open) records that "headless" today still means Electron + two Xvfb.
- **What already works without maintainer approval:** `OPENBOT_SERVER=1` self-hosted
  server, CLI over `/run/openbot/control.sock` (`status`, `login`, `mobile-connect`,
  `start|stop|restart`, `update`), and the Local scripts API (issue #1663, Bearer token
  from `<userData>/automation/`, 30 req/h per agent).
- **What depends on the maintainer:** anything that *is* an OpenBot server connected to
  their network. `docs/self-hosting.md`: hosted servers, GitHub App, Slack/Telegram bots
  and iPhone Live Activity relay stay off because *"each needs secrets that only we
  have"*; tickets are signed by their key; `openbot.run/app` does not work with a
  self-hosted account service. Upstream contribution needs CLA + `approved` label.
- **License:** PolyForm Noncommercial 1.0.0; commercial license via licenses@openbot.run.
  Relevant if this module is distributed.
- **Other project, not a fork:** `openbot-build/openbot` (AGPL-3.0) is API-first with
  packages `@openbot-build/{openbot,api,client,cli}` — a different author's work, useful
  as a reference for structure, not a drop-in.

**Practical reading:** a Bun module that *drives* an installed server (CLI/API client,
automation bridge) is viable without the creator. A module that *replaces* the backend and
connects to OpenBot's account/Signal infrastructure is not, without their secrets. The
local, self-hosted surface is where this fork can move first.

## Local architecture findings (read-only scan of this fork)

- `src/main/team-api/` has **122 `route-*.ts` files and zero `from 'electron'` imports**.
  `dependencies.ts` types its services against `../../backend/*` (agent service, browser
  host, channel, mailbox, messaging, routines, workflows) and `@openbot/contracts`.
  The HTTP/domain surface is not Electron-bound; Electron is the host that wires it.
- The shipped server entrypoints are shell wrappers that launch the **Electron** binary:
  `scripts/hosting/openbot-container` and `openbot-hosted-server` create one or two Xvfb
  displays, a dbus session and an unlocked gnome-keyring, then exec
  `/opt/OpenBot/app/openbot` with `OPENBOT_SERVER=1` or `OPENBOT_HOSTED_SERVER=1`.
  The CLI `openbot` talks to `/run/openbot/control.sock` with `curl`; the socket is
  created by the main process.
- The repo is already Bun-based for dev/test/check (`bun scripts/dev-services.ts app`,
  `bun run check`), and `scripts/hosting/openbot-hosted-server` is bash around the same
  Electron app. So Bun can run the toolchain, but **no Bun entrypoint for the server
  itself exists today**.
- `src/main/index.ts` calls `keepWindowsHidden()` in server mode; the window stays because
  `app.on("window-all-closed", () => app.quit())` would otherwise quit the app. PR #13808
  skips only the renderer, not the window.

**Implication:** the reusable surface is large (HTTP routes + backend services + contracts),
and the Electron-bound part is mostly bootstrap (window, displays, keyring, IPC bridge).
A Bun launcher can plausibly own the first group; the second needs reimplementation or a
hostless startup path. This is still a hypothesis until the architecture subagent checks
which backend services import Electron transitively.

## Open questions (to resolve with evidence, not guesses)

- Does a CLI-only server need the Electron main process at all, or can the hosted server
  and team API run as Bun services already present in the monorepo?
- How much of the Effect service graph is Electron-bound versus shared with the remote
  API worker (which already runs without a desktop)?
- Can a local-only Bun module (no account/Signal) be useful on this phone even if it
  cannot join the maintainer's network?

## Granular RAM audit of the current host (2026-11-21, measured, PSS)

From `/proc/<pid>/smaps_rollup` on the running server, arm64 phone, zram active.
PSS is what the kernel actually bills to each process.

| Process | Role | PSS | RSS | Swap |
| --- | --- | --- | --- | --- |
| `run.openbot.mobile` (Android app, outside the tree) | the actual UI the owner uses | 519 MB (dumpsys: 834 MB TOTAL PSS) | 715 MB | 122 MB |
| `opencode serve` (provider runtime) | agent sessions backend | 356 MB | 369 MB | 29 MB |
| `openbot.real` (Electron main) | wires all services, control socket, team API | 276 MB | 312 MB | 127 MB |
| `opencode acp` | ACP stdio bridge for the active turn | 92 MB | 106 MB | 22 MB |
| renderer `--type=renderer` (about:blank + WebRTC window) | **discardable in headless** | 50 MB | 85 MB | 17 MB |
| `opencode-pty daemon` | terminal sessions for agents | 28 MB | 30 MB | 18 MB |
| `--type=utility NetworkService` | Chromium network stack | 13.5 MB | 38 MB | 11 MB |
| `--type=utility NodeService` | Node bridge inside Electron | 9.3 MB | 38 MB | 36 MB |
| renderer #2 | second hidden window | 4.8 MB | 26 MB | 15 MB |
| `--type=gpu-process` | GPU for the hidden window | 4.2 MB | 22 MB | 18 MB |
| 2x `--type=zygote` | Chromium forking base | 2.9 MB | 24 MB | 21 MB |
| `--type=broker` | sandbox broker | 0.4 MB | 4 MB | 11 MB |
| 2x `cua-driver` | Computer Use driver (**discardable**) | 0.6 MB | 4 MB | 17 MB |

What this says for the Bun module:

- The **Electron-side overhead** (main + renderers + gpu + zygote + utilities + broker)
  is about **362 MB PSS**, of which ~82 MB is pure Chromium subprocesses that a Bun
  process would not have at all. The 276 MB main is Node services (Effect graph,
  SQLite, team API, control socket) — a Bun process must reproduce those, so the
  realistic saving from B is the Chromium subprocesses plus whatever the main
  process slims down to without the window/IPC wiring.
- `opencode serve` (356 MB) is the real working memory of the agents and stays in any
  scenario; it is outside Electron's tree and already shares one process for all
  sessions.
- Computer Use (`cua-driver`) is 0.6 MB PSS but needs a display; a headless host drops
  it with no memory cost.
- On this phone the app Android is the biggest single consumer (519 MB PSS) — it is the
  product's face, so the module's job is to keep it working against a leaner server.

## Viability recommendation (ordered by feasibility)

Based on the evidence above. Item 3 and the transitive Electron audit are still being
checked by an architecture subagent; everything else is confirmed from files in this
fork and from the upstream docs cited.

| Option | What it is | Feasibility | Depends on creator? |
| --- | --- | --- | --- |
| **A. Bun CLI/client that drives an installed server** | A Bun package that wraps the existing `control.sock` CLI and the Local scripts API (Bearer token, 30 req/h per agent). No server replacement. | **Highest.** Both interfaces already exist and are documented; no Electron code involved. Works today on the reference host with `openbot status/login/...` and scripted agent calls. | **No.** Local socket/HTTP only. Account sign-in still uses the owner's existing session. |
| **B. Bun launcher without Electron UI, reusing backend services** | Start the server with Bun, reuse the 122 team-API routes and `../../backend/*` services, keep the provider runtime, skip window/Xvfb/gnome-keyring. The renderer patch in PR #13808 removes the visible UI cost. | **Medium.** The domain surface has zero Electron imports and is typed against contracts/Effect, but who wires the services today is Electron's main process. Need a hostless bootstrap and a replacement for the IPC/team-API registration. | **Partly.** Local/self-hosted works; joining the maintainer's account/Signal network still needs their secrets and CLA for upstream merge. |
| **C. Pure Bun main process (no Electron at all)** | Rewrite the main process: account/Cloudflare client, ACP registry, SQLite host, Effect graph, secret redaction, control socket, shutdown semantics, plus the team API. | **Lowest.** Violates no product constraint by itself, but it is a rewrite of a large, security-sensitive surface, and a true headless build is explicitly not planned upstream (issue #1547). | **Yes** for network features. Local-only use is possible, but the result is a different product, not an OpenBot server in their network. |

**Decision for this fork:** start with **A** as a thin, useful Bun module that needs no
maintainer approval and no new permissions. Keep **B** as the research target; the team
API being Electron-free makes it plausible, and PR #13808 already removes the largest UI
cost on the current host. Do not attempt **C** before B produces evidence that the
Electron-bound bootstrap is small enough to replace. Re-evaluate if mainline ships
headless first (#6350): then rebase this fork and drop the local patches.

**What would unblock B:** a Bun entrypoint that instantiates the backend service graph
and registers the team-API HTTP routes without Electron, using the same contracts and
Effect runtime the desktop host uses today. The audit of transitive Electron imports in
`src/backend/*` is the remaining unknown; if it is shallow, B is realistic, if deep, A
is the practical end state.

### Authentication audit result (subagent, 2026-11-21, measured on the host)

- **The session does not need a keyring.** `~/.config/OpenBot/openbot-central-auth-v1.bin`
  is the app's own `obk1` container: base64 of `obk1` + IV(12) + GCM tag(16) +
  ciphertext, AES-256-GCM keyed by `secret-storage.key` (the app's fallback cipher,
  `src/main/secret-storage-cipher.ts`). The host's Chromium cookies store is empty of
  auth. A Bun module reproduces read/write with `node:crypto` and stays
  **byte-compatible with the packaged server** — either side can read the other's
  session.
- **Login is an opaque Bearer token** against `api.openbot.run`:
  `POST /v1/auth/email/start` `{email}` (Idempotency-Key) -> `{challengeId}`; then
  `POST /v1/auth/email/verify` `{challengeId, code}` -> `{sessionToken, user}`;
  `GET /v1/me` with `Authorization: Bearer`; `POST /v1/auth/logout` to revoke.
  No OAuth, no cookie, no Electron.
- **Control socket verified live:** `/run/openbot/control.sock` answers `GET /v1/status`
  with `key=value` lines (version, account, server, memory_level, `turn_limit=16`).
  The bash CLI parses exactly that — a Bun server answering the same shape keeps the
  existing CLI working with zero changes.
- **Scope of "the app sees the agents":** beyond login, the host needs the TeamStore
  identity (`openbot-team-server-v2.json`: serverId + keypair), host `register` +
  `ticket` against the account API, a signal WebSocket, and a **WebRTC data channel**
  that carries the team API to the phone (the app never talks TCP to the host). The
  WebRTC host peer is the heaviest piece of option B and the main remaining risk;
  CLI login + status + team API on loopback is reachable without it, but the server
  shows offline in the app until it exists.

### Architecture audit result (subagent, 2026-11-21) — verdict: B is viable

- **Reusable as-is:** `ServerMode` (control socket + `/v1/*`, pure `node:http`/`fs`/`net`,
  `server-mode.ts:19,92-273`), `ServerSetupPage`, `TeamApiServer` + 122 routes and
  zero Electron imports (`team-api-server.ts:1,551,678`), `HostService`, `TeamStore`,
  `CentralAuthManager`, `HostedServerService`, `AgentService` + `src/backend/agent/*`
  (ACP, routines, waits, `sendMessage`), `AutomationServer`, webhooks, i18n/contracts.
- **Needs a thin adapter:** about 13 Electron symbols in `application-services.ts:66-73`
  (`app.getPath/getVersion/isPackaged`, `powerMonitor`, `screen`, `Notification`, `Menu`,
  `shell`, `BrowserWindow`/`WebContentsView`), plus `takeServerModeEnvironment`'s
  `isPackaged` gate (`server-mode.ts:44`) and lifecycle in `index.ts:1412-1481`.
  Replace with XDG paths/version, stubs, and top-level await for `app.whenReady()`.
- **Transitive Electron in backend is shallow:** only **9 files** import Electron directly
  (`src/backend/browser-host.ts:38-60`, `browser-host-tab.ts`, `browser-cdp.ts`,
  `browser-recorder.ts`, `browser-navigation.ts`, `browser-consent.ts`,
  `browser-challenge.ts`, `browser-policy.ts`, `pinch-zoom.ts`). All belong to
  `openbot_browser`/GUI and are discardable on a headless host. Chain from `AgentService`
  goes through tool router/catalog → `openbot-tools.ts`/`browser-tools.ts` → `browser-host.ts`.
- **Discardable:** windows, 85 IPC groups, preload/renderer, 10 custom URL schemes,
  Computer Use, `desktopCapturer`, tray/dock/notch/dynamic island, deep links, desktop
  notifications.
- **Option A** already exists as a Bash client over `control.sock`; a Bun version is a
  low-risk formalization of that contract. **Option C** would touch ~70 files in
  `src/main/` and `index.ts` (~1,900 lines) and has a worse RAM payoff than the renderer
  patch already shipped: the remaining main process is 226-234 MB of Node/services, not
  Chromium.
- Caveat from the audit: it confirmed direct imports plus grep-inferred chains, not a
  full transitive graph; it did not validate Bun compatibility of native addons or run
  a build. Treat as a grounded feasibility signal, not a proven implementation.

### Bootstrap audit result (subagent, 2026-11-21) — the composition is confirmed

- **Minimum boot order** (17 steps, mirrors `index.ts:1412-1858`):
  env/paths → timezone+logs → secret storage (file key) → `CentralAuthManager.initialize`
  → `OpenBotDatabase`+`AgentStore`+`MailboxStore`+`AgentTables`+supervisor →
  `ProviderRuntimeManager`+`ProviderCredentialStore` → `AgentService` →
  `AutomationServer` (optional) → `TeamStore` → `ServerMemory` → `HostService` →
  `ServerMode.listen()` (control socket) → publish policy on `centralAuth.on("changed")`
  → `AgentInitializationGate` → signal teardown.
- **The 13 Electron symbols** of `application-services.ts:59-73` all have a headless
  answer: `app.getPath/getVersion/isPackaged` -> XDG + package.json; `BrowserWindow`,
  `Menu`, `screen`, `webContents`, `desktopCapturer` -> eliminated; `clipboard`, `shell`,
  `powerMonitor`, `systemPreferences`, `Notification` -> stubs; `nativeImage` -> magic
  byte sniff; `net` -> native fetch. Plus 3 indirect swaps: `utilityProcess.fork` ->
  Bun spawn, `safeStorage` -> file key, `account-service-access` -> plain fetch.
- **Agents do not fork per turn**: one shared ACP client per provider
  (`provider-drivers.ts:796-826`, `acp-connection.ts:70-89`); `opencode acp` (92 MB PSS)
  is the stdio bridge and `opencode serve` (356 MB PSS) the real backend — both stay.
- **RAM estimate for the Bun process: 150-200 MB PSS** (Effect subset + node:sqlite +
  Bun baseline) vs the 276 MB Electron main, plus ~85 MB of Chromium subprocesses gone:
  **~135-175 MB saved in the tree**. Labeled estimate until measured.
- **Risk order:** 1) verify `node:sqlite`/WAL and unix-socket `chmod 0600` under
  Bun/arm64; 2) fill the `AgentService` options bag; 3) `HeadlessBrowserHost` refusals;
  4) DB-host spawn swap; 5) WebRTC mobile bridge (or `host.startLoopbackOnly`
  short-term); 6) routines/workflows second phase; 7) single-instance lock so the
  Electron server and the Bun server never share one userData at the same time.
- **Verdict:** viable with one entrypoint + 4 adapters; no server service imports
  Electron. The complexity lives in the `AgentService` options bag and the mobile
  WebRTC bridge, not in the control socket or the team API.

### What is already wired in this fork

`packages/server-headless/src/`:
- `main.ts` — the composition skeleton with real imports, done and TODO sections.
- `headless-secret-storage.ts` — implements the `obk1` container (AES-256-GCM, same
  byte format) with `node:crypto`; byte-compatible with the packaged server.
- `headless-browser-host.ts` — refuses every browser tool ("descarte browser").
- `headless-database-host.ts` — spawn swap stub (blocked on the compiled entry).

## Non-goals for the first milestone

- No Computer Use / GUI automation, desktop notifications, tray/dock, deep links or
  keyring integration on the headless host. Those stay in the desktop build.
- No data migration, no schema change, no force-push, no change to `main`.

## Evidence pointers

- Measurements: `docs/headless-server-mode-update-2026-11-21.md`, issue #13807, PR #13808.
- Repo rules: root `AGENTS.md`, `docs/architecture/change-rules.md`, `CONTRIBUTING.md`.
- Local host docs (outside this repo): `android/docs/DEVICE-PROFILE.md`.
