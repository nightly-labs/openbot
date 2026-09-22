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
tenant. The system `admin` group may write to that parent; public or tenant-group write access is rejected.
Framework symlinks must remain inside the application. Initial setup accepts a signed app owned
by root or the installing administrator, then removes group/public write access and assigns it
to root. It refuses a tenant-owned or publicly writable bundle. It never changes tenant data.

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
  host-manager      root:wheel 0755; compiled daemon
  openbot-host      root:wheel 0755; administrator CLI
  create-tenants    root:wheel 0755; native account helper
  host-release.json root:wheel 0644; release version, source commit, architecture
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

## Production installation

Normal desktop users need only `OpenBot-<VERSION>-arm64.dmg`. Managed multi-tenant hosts also
need `OpenBot-Host-<VERSION>-arm64.pkg` from the same GitHub Release. The Host package contains
standalone ARM64 executables, the global Aqua LaunchAgent, the root LaunchDaemon, and the
`/usr/local/bin/openbot-host` administrator command. The target Mac needs no Git checkout, Bun,
Node, Xcode, or compilation.

1. Download the normal DMG and the Host PKG from the same release.
2. Open the DMG and copy OpenBot.app to `/Applications`. Quit OpenBot before initial host setup.
3. Open the Host PKG in Installer, or run the command below with the downloaded filename.
4. Create and register the new Standard accounts. Save the passwords shown at completion.
5. Log into `client-acme` once and sign into that client's OpenBot and providers.
6. Use Fast User Switching, log into `client-bravo`, and configure that client's OpenBot.
7. Run verification as the host administrator.

```sh
sudo installer -pkg "$HOME/Downloads/OpenBot-Host-<VERSION>-arm64.pkg" -target /
sudo /usr/local/bin/openbot-host setup --create-user client-acme --create-user client-bravo
sudo /usr/local/bin/openbot-host verify
```

Replace `<VERSION>` with the downloaded release version. `/usr/local/bin` is a standard PATH
location; the absolute command also works when an administrator's PATH omits it.

For existing Standard accounts with private homes, use:

```sh
sudo openbot-host setup --tenant client-acme --tenant client-bravo
```

The flags may be mixed. Use distinct lowercase names, starting with a letter, with at most 31
letters, digits, hyphens or underscores. `--create-user` refuses existing accounts, old group
membership names, and existing home paths. `--tenant` never changes an existing password or home.
A `setup --dry-run` checks installation, accounts, and the already-secured application without
creating accounts or changing configuration. Actual initial setup can secure an administrator-owned
DMG copy. Setup refuses existing host registration; it is not an account-reset command.

Only the administrator needs sudo. Setup creates empty `0700` homes and verifies Standard
membership before registration. It grants no sudo, Full Disk Access, automatic login, Secure Token,
or FileVault unlock rights. An administrator must unlock a FileVault-protected host after reboot.

Passwords contain 192 random bits. The native account tool sends them to OpenDirectory in memory,
then to the administrator CLI through a captured pipe; they never enter process arguments,
environment variables, host configuration, or logs. At successful setup completion, the CLI shows
each password once on the controlling terminal, separately from redirected stdout. A terminal is
required before new-account setup starts. Deliver each password through your secure credential
channel. The CLI uses a new root-owned `0600` recovery file under `/private/var/root` during setup
and removes it after password presentation. If setup fails, keep that file until the administrator
has recovered the partial accounts. Do not attach it to diagnostics or commit it to a repository.

A failed batch may leave accounts, empty homes, or registration created. Setup stops at the first
failure and never deletes accounts or overwrites existing registration on retry. Do not run other
account tools or a package upgrade concurrently. A crash can leave the root-owned
`setup-in-progress` directory; an administrator must resolve the partial setup before removing it.

The package installs the LaunchAgent globally in `/Library/LaunchAgents`. Logged-out users load
it at their next Aqua login; setup does not need every user logged in. The per-user wrapper checks
only its own UID. Acme running cannot prevent Bravo from launching. A 15-second retry covers
session startup and failed launches. No tenant GUI app is launched from root with `sudo -u`.
Every registered tenant must eventually be running and healthy for automatic app updates.

## Verification

`sudo openbot-host verify` checks the application signature and permissions, all host executable
signatures, fixed launchd definitions, daemon state, root-owned config/state, and each tenant's
Standard membership and home metadata. It also creates harmless files in a temporary host
verification area, tests access as each tenant in both directions, and removes that area.
It does not recursively inspect homes, read tenant filenames/content, or print credentials.
The temporary-area test supplements, but does not replace, the actual home-boundary acceptance
check below. A failed check gives a nonzero exit status. Run verification after setup and upgrades.

## Host infrastructure upgrades

Install a newer signed and notarized Host PKG as administrator. The installer refuses unsafe
existing paths and active/interrupted maintenance. It stops the daemon before replacing host
executables and starts it again when configuration exists. Initial package installation does not
start an unconfigured daemon. Existing config, state and tenant status directories are outside the
package payload and remain in place. A failed package installation can leave the daemon stopped;
resolve the package failure and run verification before returning the host to service.

OpenBot.app continues to update through the Host Manager. The Host Manager does not update itself,
download a Host PKG, or alter its own executable. A newer application may run with an older Host
package. Initial setup requires the matching or a newer application. Host PKGs are never listed in
`latest-mac.yml` and normal desktop users never receive them through Electron auto-update.

## Developer validation

The repository-only `scripts/install-host-update-agent.sh` remains a development setup path.
Production uses the release PKG and installed CLI. Release CI builds the binaries from the same
release commit as OpenBot.app. Native tests use a fake account service and temporary files:

```sh
xcrun swiftc -parse-as-library -D TENANT_SETUP_TESTS scripts/macos-tenant-setup.swift scripts/macos-tenant-setup-tests.swift -o /tmp/openbot-tenant-setup-tests
/tmp/openbot-tenant-setup-tests
bun run test:desktop -- scripts/openbot-host.test.ts scripts/verify-host-installer.test.ts scripts/host-manager.test.ts
```

macOS tests build and expand an unsigned fixture package without installing it. Production package
verification also requires Developer ID signatures, notarization, stapling, an exact ownership/mode
manifest, standalone launch checks without Bun/Node in PATH, and the expected source scripts.

## Live status

`sudo openbot-host status` prints one read-only snapshot: management flag, daemon state, phase,
staged version, update cycle, recorded error, and one line for each registered tenant with its
version, health, work state, and the reason it blocks maintenance. `--json` gives the same report
for scripts. `sudo openbot-host watch [--interval <seconds>]` repeats the snapshot, default every
five seconds. Both commands only read `config.json`, `state.json`, and each tenant status file.
They never write host state, never open a tenant home, and never start or stop maintenance.

While the host waits, each idle tenant shows the remaining five-minute grace. This value is the
earliest possible time, not a promise: the host counts from its own first observation of that idle
report, and new work resets the grace. In the `idle` phase there is no countdown, because the host
keeps its next release check in memory; a check occurs at most every four minutes.

Only the `waiting` and `stopping` phases rewrite `state.json` at every poll, so only those phases
can show a stalled daemon through the state age. Use the reported daemon state in the other phases.

## State and recovery

Read `state.json` as the administrator. Phases are `idle`, `downloading`, `waiting`, `stopping`,
`installing`, `released`, `aborted`, and `failed`. A new installed version is announced in `released`,
after checking `CFBundleShortVersionString` on the actual shared bundle. A download or a return
from an installer call is never treated as success.

A two-hour idle timeout, two-minute shutdown timeout, or ten-minute health timeout records an
error. A failure before replacement uses `aborted`: the old bundle stays in place and tenants
can still start it manually. If shutdown was partial, the host verifies the unchanged installed
bundle and records its version in `aborted`. Aqua agents can then restart stopped tenants after
their own signature/version check. If verification fails, the version is null and no automatic
restart occurs. A network failure cannot prevent core app use. A failed or interrupted installation
blocks automatic relaunch and further installation.
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
