# Multi-tenant hosting on one Mac

This guide covers operation of several isolated OpenBot tenants on one Apple Silicon Mac.
Each tenant is one native macOS Standard user with one OpenBot instance. The macOS
account is the security boundary. No VMs, no Docker, no Tailscale for client access:
clients connect through the Team API with WebRTC and the operator's STUN/TURN servers.

## What is shared and what is not

Shared across tenants on one Mac:

- `/Applications/OpenBot.app` — one application bundle for all tenants.
- The host network namespace — two macOS users still share loopback ports.
- The public IP address and the operator's STUN/TURN infrastructure.

Separate per tenant (per macOS user, enforced by file ownership and macOS permissions):

- `~/Library/Application Support/OpenBot/` — database (`openbot.db`), Team host
  identity, provider credentials, logs, remote desktop state.
- `~/OpenBot/` — agents, workspaces, shared files.
- `~/.codex`, `~/.claude` — provider logins and provider session state.
- `~/Library/Caches/app.openbot.desktop.ShipIt/` — per-user update staging.
- Sunshine/Moonlight ports — each OpenBot instance reserves a disjoint Sunshine
  port family and a disjoint Moonlight WebRTC range at Remote Desktop start.

## Upgrades are host-wide maintenance

Replacing `/Applications/OpenBot.app` while another tenant's OpenBot process runs
from it breaks that session. OpenBot coordinates this in the application:

- Every instance reports restart safety (`safeToRestart` with reasons: agent turns,
  queued deliveries, drains, routine runs, channel work, provider processes, connected
  Remote Desktop streams, live browser views, browser control sessions, moving file
  transfers, updater work, pending initialization). Open tabs and connected Team API
  clients alone never block; they reconnect after the restart.
- One instance leads through lock files in `/Users/Shared/OpenBot/updates/`. It waits
  until every tenant stayed safe continuously for the idle grace period (5 minutes),
  tells everyone to stop, waits until all stopped, replaces the bundle once through
  its own updater, and publishes the release marker.
- Each tenant quits itself when told and safe. A per-user LaunchAgent watches the
  release marker and reopens OpenBot inside that tenant's GUI session.
- After relaunch each tenant probes itself (initialization settled, agent list
  readable) and reports health; the host writes `alert-<version>.json` when a tenant
  is missing or unhealthy, or when tenants never go idle within 2 hours.
- A tenant install outside this flow stays refused while siblings run, and in managed
  mode tenants never install on their own at all.

### One-time host setup

As an administrator, with the tenant users already created and logged in:

```bash
sudo scripts/install-host-update-agent.sh --managed client-acme client-bravo
```

This creates the shared coordination directory, installs the relaunch wrapper and the
per-user relaunch agents, seeds the release marker, and drops the host-managed flag
(`/Library/Application Support/OpenBot/host-managed.json`). Tenants then show update
status with a "Managed by host" action instead of install buttons. Delete the flag to
return to self-serve updates (the sibling refusal still applies).

### What the administrator watches

```text
/Users/Shared/OpenBot/updates/
  intent.json        waiting | stopping | installing | done | aborted, with reason
  release.json       latest installed version
  health-<uid>.json  per-tenant self report after relaunch
  alert-<version>.json  complete flag plus per-tenant results
```

An `aborted` intent means tenants never went idle: work with them, or stop OpenBot
in every tenant account and install from one tenant manually. An incomplete alert
means a tenant did not return: check that tenant's session and logs, and do not
replace the bundle again until it is healthy. There is no automatic rollback:
downgrading under migrated databases is not safe, so failures stay on disk and
stay visible instead.

### Manual procedure (unmanaged hosts)

```text
1. Tell all tenants about the maintenance window.
2. Stop OpenBot in every tenant account (quit the app, do not only switch users).
3. Confirm no OpenBot process remains for any tenant UID:

   ps -ax -o pid,uid,command | grep -F "OpenBot.app/Contents/MacOS/OpenBot" | grep -v grep

4. Install the update from one tenant's OpenBot: check for updates, download,
   restart into it. The install is refused while any sibling still runs.
5. Start that tenant, confirm version, agents, conversations, Team host.
6. Start the next tenant, confirm the same.
```

## Recovery

- Normal reboot, power failure, macOS update reboot: log each tenant user in
  again (FileVault stays on; no automatic unlock), then start OpenBot in each
  session. Fast User Switching keeps the other session alive.
- OpenBot crash: restart OpenBot in that tenant's session only. The other
  tenant is not affected.
- Individual client logout: that tenant's OpenBot stops with the session.
  Log the user in again and start OpenBot.
- Failed update: the refusing message names the cause. When every other
  session stopped and the install still fails, quit and reopen OpenBot in the
  installing tenant and try again; the update stays ready.
