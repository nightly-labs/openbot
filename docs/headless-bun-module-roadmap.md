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

- POCO X7 Pro / `rodin` (global model `2412DPC0AG`, China name Redmi Turbo 4),
  MediaTek Dimensity 8400-Ultra / MT6899, 8 cores.
- Android 17, ColorOS 17 "TheLastBloom" (port by @NEESCHAL_3), KernelSU Next.
- 10 GiB RAM visible in the chroot (12 GB marketed), zram 12 GiB lz4 priority 100,
  no writeback device; `MemAvailable` 1.5 GiB before zram, 3.4-3.7 GiB after.
- Arch Linux ARM chroot at `/data/arch`, started from Android's init through a KernelSU
  `service.d` script; OpenBot runs as `OPENBOT_SERVER=1` under `xvfb-run` today.
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

## Open questions (to resolve with evidence, not guesses)

- Does a CLI-only server need the Electron main process at all, or can the hosted server
  and team API run as Bun services already present in the monorepo?
- How much of the Effect service graph is Electron-bound versus shared with the remote
  API worker (which already runs without a desktop)?
- Can a local-only Bun module (no account/Signal) be useful on this phone even if it
  cannot join the maintainer's network?

## Non-goals for the first milestone

- No Computer Use / GUI automation, desktop notifications, tray/dock, deep links or
  keyring integration on the headless host. Those stay in the desktop build.
- No data migration, no schema change, no force-push, no change to `main`.

## Evidence pointers

- Measurements: `docs/headless-server-mode-update-2026-11-21.md`, issue #13807, PR #13808.
- Repo rules: root `AGENTS.md`, `docs/architecture/change-rules.md`, `CONTRIBUTING.md`.
- Local host docs (outside this repo): `android/docs/DEVICE-PROFILE.md`.
