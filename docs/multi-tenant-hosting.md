# Multi-tenant hosting on one Mac

Use one native macOS **Standard user** and one OpenBot instance per tenant. The shared
application is `/Applications/OpenBot.app`. Client connections use the existing Team API,
WebRTC, and the operator's STUN/TURN infrastructure. No VM or Docker is involved.

This setup protects tenant files through macOS ownership and permissions. It does **not**
provide resource isolation against a hostile tenant: native users share CPU, memory, storage
capacity, and the network namespace. A tenant can consume resources or occupy ports. An idle
update requires cooperation from every registered tenant; one tenant can block maintenance.
Do not promise independent availability on a shared native host.

## Data and permissions

Before enrollment, the administrator must create each Standard account with a private home:
owner is that tenant, mode `0700`, and no ACL that grants another tenant access. Check home
metadata without opening tenant content. Do not share writable groups or grant Full Disk Access
or administrator rights to tenants. Do not enable shared folders for tenant content.

The home boundary protects `~/OpenBot`, OpenBot's database and browser profiles under
`~/Library/Application Support/OpenBot`, `.codex`, `.claude`, credentials, and conversations.
A tenant can deliberately share its own files; that is outside the private-account policy.

The application and all its real contents must be root-owned with no group/public write bits
and no access-granting ACLs. `/Applications` must also be root-owned and not writable by a
tenant. The current verifier requires mode `0755` or stricter on that parent, including removal
of group write permission. Framework symlinks must remain inside the application. The setup
refuses unsafe permissions; it does not change tenant data or silently repair an unsafe bundle.

Remote Desktop reserves separate Sunshine port families and Moonlight WebRTC ranges. Each fixed
WebRTC UDP range has a TCP reservation at its first port until the runtime stops. This keeps
separate processes from selecting the same range before streaming begins. Stored
Moonlight endpoints are recreated when the allocated port changes. The local Moonlight
header has a random per-process credential, stored only in the private runtime config; automatic
password-based administrator enrollment is disabled. Sunshine credentials use the pinned native
runtime's salted hash file format, so plaintext passwords do not appear in process arguments.

## Host Manager boundary

A standalone compiled helper runs as the root LaunchDaemon `app.openbot.host-manager`.
Its entry point is `scripts/host-manager.ts`. It owns only these functions:

1. Read the admin configuration and non-sensitive tenant status.
2. Download the latest stable Apple Silicon release from the fixed OpenBot GitHub repository.
3. Check code signing, notarization assessment, bundle version, ownership, and permissions.
4. Wait for every registered tenant to report safe status for five minutes.
5. Publish a stop request; each tenant rechecks its own state and quits itself.
6. Verify through the OS process list that all OpenBot main processes have exited.
7. Replace the shared bundle, then verify its signature, permissions, and installed version.
8. Publish `released`; per-user LaunchAgents start OpenBot in their existing Aqua sessions.
9. Collect fresh health reports, or record a host error.

The helper never opens a tenant home, workspace, database, provider directory, browser profile,
conversation, or attachment. It does not copy or back up tenant data. It reads executable paths
and UIDs from `ps`, not process arguments. Downloads and app-only staging are root-private.
The retired application is removed after verification; it is never used for automatic rollback.
The helper itself is updated separately by an administrator, not by a tenant or downloaded code.

```text
/Library/Application Support/OpenBot/HostManager/    root:wheel 0755
  config.json       root:wheel 0644; managed flag and registered numeric UIDs
  state.json        root:wheel 0644; phase, cycle, version, timestamp, error
  host-manager      root:wheel 0755; compiled helper
  openbot-relaunch.sh root:wheel 0755
  private/          root:wheel 0700; download and read-only DMG mount
  tenants/          root:wheel 0755
    <uid>/          tenant:wheel 0700; parent entry cannot be replaced by tenant
      status.json   tenant-owned; status for that UID only
```

Tenant status contains UID, PID, version, heartbeat, idle state, update cycle, and a health
boolean. No user paths, activity text, prompts, or error details cross this interface. The host
checks the file owner's UID, bounded size, regular-file type, single link, and permissions.
Reads use `O_NOFOLLOW`; writes use exclusive temporary files and atomic rename. The host never
writes inside a tenant status directory. Missing, stale, malformed, or unregistered state cannot
remove a tenant from the maintenance set. There is no world-writable directory and no election.

Work events reset the tenant's five-minute idle grace even when a task finishes between status
polls. The tenant also checks its own full idle grace before it accepts a stop request. Health
and restart readiness remain false before initialization and after an initialization failure.

With `managed: false` or no admin configuration, the host client does not publish status or stop
the app, and the daemon does not coordinate updates. Normal desktop update controls return. With
`managed: true`, all tenant update controls are disabled, including downloads and installation.
The host download does not use or change a tenant's `autoDownload` preference.

## Installation

### Create tenant accounts automatically

For new accounts, compile the administrator setup tool from a trusted checkout as an
unprivileged developer. This requires the Xcode Command Line Tools:

```sh
xcrun swiftc -parse-as-library scripts/macos-tenant-setup.swift -o /tmp/openbot-create-tenants
sudo /tmp/openbot-create-tenants client-acme client-bravo
```

The command creates local Standard users with unique UIDs, independent generated passwords,
and new empty `0700` homes under `/Users`. Use lowercase account names, starting with a letter,
with at most 31 letters, digits, hyphens, or underscores. Existing accounts, group membership
names, and home paths (including symlinks) cause setup to stop. It never resets an existing
password, changes an existing home, or deletes an account to recover from failure.

Passwords contain 192 random bits and are sent directly to Apple's OpenDirectory API in memory.
They are not placed in command arguments, environment variables, stdout, or error messages.
Before creating accounts, the tool saves a new root-owned `0600` credential file at
`/private/var/root/openbot-tenant-credentials-<UUID>.json`. The terminal shows only this path and
successful account names. Retrieve the passwords as the administrator, deliver each password
to its tenant through your secure credential channel, and remove the file when no longer needed.
Do not attach this file to diagnostics or commit it to the repository.

A failed batch can leave some accounts or empty homes created. The credential file retains all
planned passwords, including accounts that were not created. Inspect the partial setup as the
administrator; the command stops at the first failure and will not overwrite it on retry.
Do not run other account-creation tools at the same time. The tool serializes its own invocations,
but macOS does not provide a transaction across independent administrator tools.

This is a one-time setup tool, separate from the update daemon. It does not enroll accounts with
the Host Manager, enable automatic login, grant administrator rights, or grant Secure Token or
FileVault unlock rights. Log each account into a GUI session before enrollment. If the host uses
FileVault, its administrator must unlock it after a restart. Verify account login, private home
permissions, and lack of administrator membership on the target Mac before tenant use.

The native tests use temporary files and a fake account service. They do not create users:

```sh
xcrun swiftc -parse-as-library -D TENANT_SETUP_TESTS scripts/macos-tenant-setup.swift scripts/macos-tenant-setup-tests.swift -o /tmp/openbot-tenant-setup-tests
/tmp/openbot-tenant-setup-tests
```

### Install host management

Use a trusted checkout. As an unprivileged developer, build the standalone helper:

```sh
bun install --frozen-lockfile
bun build scripts/host-manager.ts --compile --outfile /tmp/openbot-host-manager
```

On the target Apple Silicon Mac, install a signed OpenBot build that contains the tenant client,
set the application and home permissions above, and log each tenant into a GUI session. Then:

```sh
sudo scripts/install-host-update-agent.sh --managed /tmp/openbot-host-manager client-acme client-bravo
```

Only administrator setup needs sudo. The script checks Standard membership and private home metadata for accounts under `/Users/<name>`.
It never opens home contents. The script installs the common LaunchAgent under
`/Library/LaunchAgents`; it does not write into tenant homes. A logged-out user's agent loads at
its next GUI login. Every registered tenant must be running and healthy before automatic
maintenance can complete. The installer refuses existing configuration instead of overwriting it.
If testing an older version of this PR, remove its per-user relaunch job from each tenant's own
session before enrollment; the old `/Users/Shared/OpenBot/updates` protocol is not used.

Verify the jobs and the application metadata:

```sh
sudo launchctl print system/app.openbot.host-manager
launchctl print gui/$(id -u)/app.openbot.desktop.relaunch
ls -ld /Applications/OpenBot.app
ls -le /Applications/OpenBot.app/Contents/MacOS/OpenBot
```

The per-user wrapper checks only its current UID. Acme running cannot prevent Bravo from
launching. A 15-second retry covers delayed GUI startup and a failed `open` attempt. No
`sudo -u tenant open` is used. A tenant startup checks host state before it starts its services. The wrapper calls the helper's
nonprivileged `--relaunch` path; it checks executable paths and filters by the current UID.

## State and recovery

Read `state.json` as the administrator. Phases are `idle`, `downloading`, `waiting`, `stopping`,
`installing`, `released`, `aborted`, and `failed`. The installed version is announced only in `released`,
after checking `CFBundleShortVersionString` on the actual shared bundle. A download or a return
from an installer call is never treated as success.

A two-hour idle timeout, two-minute shutdown timeout, or ten-minute health timeout records an
error. A failure before replacement uses `aborted`: the old bundle stays in place and tenants
can still start it manually. A network failure cannot prevent core app use. A failed or interrupted installation blocks automatic relaunch and further installation.
Stop the system job, inspect application-only staging and the installed signature/version, and
resolve the error. After all tenants are stopped and the bundle is verified, an administrator can
reset `state.json` to `idle` with a new empty cycle and null version, then restart the system job.
Do not reset state while a replacement is running. Do not downgrade after a tenant has migrated
its database. No tenant-data backup is created or assumed.

To disable management, stop the system daemon and atomically set `managed` to `false` in the
root-owned configuration. Tenants regain ordinary desktop controls. The shared root-owned
application still requires administrator maintenance; do not make it tenant-writable. To enable
management again, verify that no maintenance was interrupted before restarting the daemon.

## Target-host acceptance (required before paying-client use)

This is not replaced by tests that run under one UID:

- From Acme, attempts to list/read/create/replace a harmless test file in Bravo's private home
  must fail; repeat in the opposite direction. Each tenant creates its own test file.
- Both tenants must fail to create or remove a test entry in the shared app and to replace its
  executable. Check ACLs as well as mode bits. Do not modify an actual executable for this test.
- Confirm that each tenant cannot create another UID's status, replace host config/state, or
  replace its parent status directory with a symlink.
- Run both Remote Desktop sessions, restart in reverse order, and confirm both reach their own
  screen. Try a request with the other session's local Moonlight header and confirm rejection.
- Exercise busy agents, provider activity, queued channel work, file transfers, browser control,
  and Remote Desktop. Each blocks maintenance; busy status resets the five-minute grace.
- Set both tenant download preferences off. Confirm one host download still occurs while they work.
- Use a signed newer build. Confirm all tenants exit, bundle replacement completes, and only then
  `released` appears. Confirm Acme-first and Bravo-first relaunch in their own Aqua sessions.
- Simulate a stopped daemon during maintenance and a failed version verification. Confirm no
  success marker or automatic relaunch, and check the host error.
- Confirm fresh health reports for the new version. Disable and re-enable management and verify
  that unmanaged mode never requests automatic tenant shutdown.

The development computer used for this change has no `/Applications/OpenBot.app`, no native
Remote Desktop runtime artifact, and no two-tenant acceptance setup. Actual signing assessment,
DMG installation, cross-UID permissions, and Aqua relaunch still require this target-host run.
