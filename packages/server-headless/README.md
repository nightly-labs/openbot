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

## A real turn with the free model (milestone 4)

The host now wires the **real `ProviderCredentialStore`** (encrypted
`openbot-provider-credentials-v1.json` + file-key cipher — no keyring) into the real
AgentService, and `OPENBOT_HEADLESS_MODEL` pins the first agent's model. The default
test model is `opencode/deepseek-v4.1-flash-free` (OpenCode Zen's free tier of DeepSeek
V4.1 Flash): **no key, no account** — the ACP runtime is the opencode binary, so the
free tier applies as-is.

One full turn, end to end, measured on the phone:

```sh
bun packages/server-headless/scripts/free-model-turn.ts
# model=opencode/deepseek-v4.1-flash-free provider=opencode agent=agent-...
# boot=13772 ms (socket + agents ready + model pinned)
# login=ok member=... agents=1
# reply=5536 ms text="headless bun turn ok"
# pss server=237.2 MiB acp=748.1 MiB (3 child)
# TURN PASS
```

That is: `POST /v1/auth/login` over the loopback team API → Bearer →
`POST /v1/agents/{id}/messages` (the route the mobile app uses) → AgentService →
ACP → opencode 2.2.5 → the free model → the reply in the conversation. Cold turns
(overlapping the agent-creation turn) run 4-6 s; steady-state turns 2.4-2.6 s.

## The shared database host as a Bun child (milestone 5)

The AgentService now receives real `tables`: the repository's database host entry
(`src/backend/agent-data/agent-database-host.ts` — the file the packaged app bundles
and forks via `utilityProcess`) runs as a **Bun child process** through its stdio
fallback (JSON lines over stdin/stdout, no Electron parentPort), under the REAL
`AgentDatabaseSupervisor` and `AgentTables`. The tool turn in `free-model-turn.ts`
asks the free model to create a shared table; the model calls the table tools on its
own and the row is verified straight from `agent-data.db`:

```sh
bun packages/server-headless/scripts/free-model-turn.ts
# ...
# tool=10891 ms reply="Done — table `probe_free_turn` created ..." probe_free_turn.note="hello bun tools"
# TURN PASS
```

Supervisor timings on the phone: first write 19.4 ms (child start + provision), warm
statements 0.03-2.8 ms. The test host pins `openbotRoot` inside its own userData, so
agent workspaces and shared tables never touch the live `/var/lib/openbot/OpenBot`
directory.

## Verified on the phone (2026-11-21)

- `node:sqlite` with WAL works under Bun/arm64.
- The obk1 cipher round-trips (headless copy and cross-instance read).
- The control socket serves `key=value` and the CLI parses it.
- **The repository's own server modules load under Bun** (`server-mode`,
  `central-auth-manager`, `team-api-server`, `host-service`, `agent-service`,
  `secret-storage-cipher`, `team-store`, `automation-server`) once Electron is aliased
  to `src/electron-stub.cjs`.

### The Electron alias (how to apply and revert)

Bun resolves `electron` from its global cache, not from `node_modules`. The shim:

```sh
CACHE=$(bun pm cache dir)/electron@<version>@@@1   # e.g. electron@45.3.4@@@1
cp "$CACHE/index.js" "$CACHE/index.js.electron-original"   # once
printf 'module.exports = require("/home/deivi/Projetos/openbot/packages/server-headless/src/electron-stub.cjs");\n' > "$CACHE/index.js"
```

Revert:

```sh
cp "$CACHE/index.js.electron-original" "$CACHE/index.js"
```

The same shim exists at `node_modules/electron/index.js` (with the original saved as
`index.js.electron-original`). Both are local, reversible, and outside git.
