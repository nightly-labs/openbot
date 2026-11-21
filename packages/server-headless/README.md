# @openbot/server-headless (research, WIP)

A Bun-only OpenBot host: no Electron, no Xvfb, no dbus session, no gnome-keyring, no
desktop window. It exists so the mobile app (and a desktop client) can drive the same
agents this repository serves today, on hosts where every megabyte counts.

Status: **scaffold, not functional.** This package is the fork's research vehicle for
`docs/headless-bun-module-roadmap.md` (option B). Nothing imports it from the app, and
it changes no runtime behavior of the shipped server.

## What it must do (the contract)

1. Expose the same control socket as the packaged server (`/run/openbot/control.sock`,
   `GET /v1/status`, `POST /v1/login/{start,verify,claim}`, `/v1/name`,
   `/v1/mobile-connect`, `/v1/logout`) with `key=value` responses, so the existing
   `openbot` CLI keeps working unchanged.
2. Serve the team API on `127.0.0.1` (the surface in `src/main/team-api/`, 122 routes,
   zero Electron imports) so the mobile app sees agents, chats, routines and waits.
3. Run agent turns through the ACP provider runtime (opencode) the same way
   `AgentService` does, with the provider sessions persisted under the same
   `~/.config/OpenBot` tree the desktop host uses on this machine.
4. Authenticate the owner with email + code from the terminal. **Confirmed by audit:**
   the session is an opaque Bearer token from `api.openbot.run`
   (`/v1/auth/email/start` -> `/v1/auth/email/verify`), persisted as
   `openbot-central-auth-v1.bin` in the app's own `obk1` format (AES-256-GCM keyed by
   `secret-storage.key`) — no keyring involved, so Bun + `node:crypto` reproduces it
   exactly, and the packaged server can read the session this module writes (and
   vice-versa).
5. Publish the host for the mobile app: TeamStore identity
   (`openbot-team-server-v2.json`, serverId + keypair), host `register` + `ticket`
   against the account API, signal WebSocket, and a **WebRTC data channel** carrying
   the team API to the phone. Without this gateway the account signs in, but the server
   shows offline in the app.
6. Drop, explicitly: `openbot_browser`, Computer Use, tray/dock, desktop notifications,
   deep links, every hidden window, Xvfb, dbus, gnome-keyring.

## Why it is plausible

- `src/main/team-api/` has zero Electron imports; `dependencies.ts` types against
  backend services and `@openbot/contracts`.
- Only 9 files under `src/backend/` import Electron, all in the browser feature.
- The control socket is plain `node:http` over a unix socket (`server-mode.ts`).
- The main process's 276 MB PSS is Node services (Effect graph, SQLite, team API), not
  Chromium; the Chromium subprocesses (~82 MB PSS) disappear entirely in Bun.
- See `docs/headless-bun-module-roadmap.md` for the full audit and the measured table.

## Not this package's job

- Joining the maintainer's hosted-server network (needs their secrets).
- A TUI. The terminal surface stays the existing `openbot` CLI; a TUI can wrap it later.
- Any change to the shipped app or to `main`.

## Run (eventually, on the reference phone)

```sh
bun packages/server-headless/src/main.ts   # server
bun packages/server-headless/src/cli.ts login you@example.com   # auth by email code
```

The reference host is the arm64 phone described in
`docs/headless-server-mode-update-2026-11-21.md` (POCO X7 Pro / `rodin`, Arch chroot,
KernelSU, zram). Native modules (SQLite, crypto) must be verified under Bun on arm64
before anything here is trusted.
