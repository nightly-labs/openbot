# Change rules and verification

## Effect service execution

Service workflows use the catalog-pinned `effect` 4.0.0 package. Read the source and
reference material in the installed package when changing these workflows. The Electron
main process, account Worker, site-router Worker, Signal service, and shared team client
use the same version. Framework routing, IPC validation, UI rendering, and event delivery
keep their native interfaces.

Effects compose domain operations and typed failures. Promise interfaces remain at
framework and SDK boundaries. These interfaces unwrap expected failures with
`Effect.result`; defects and interruption can still reject. Existing public error
mapping and secret redaction remain the responsibility of each boundary.

Long-lived service graphs own their managed runtime and dispose it at shutdown. Provider
discovery registers disposal in the desktop teardown registry. Each remote peer owns its
runtime until peer disposal. Signal owns a process runtime. Worker service dependencies
belong to a request or invocation; they must not retain request bindings in a global
runtime. Response streams and `waitUntil` tasks retain their framework lifetimes.

Constructor-injected services expose one Effect operation per async method. Service ports
accept Effects, and callers compose them directly. There are no paired Promise facades.
Deferred values share pending results; semaphores preserve operation order; owned scopes
retain background fibers until cleanup. Synchronous SQLite transactions stay synchronous.
A mutation that must finish before rollback or shutdown uses an explicit interruption boundary.

The renderer and mobile application workflows remain outside this migration. Their native
callbacks execute shared client Effects and keep existing UI and event behavior. Electron window management,
HTTP routing, IPC handlers, SDK callback registration, and startup/teardown hooks remain
framework code. They call Effect service boundaries and await resource disposal.

The isolated agent database host imports Effect from the installed package. It keeps
its separate process, SQL authorizer, and frozen line protocol. The supervisor can still
terminate a process blocked in synchronous SQLite work. Desktop packages unpack Effect
with the host, and package verification checks that the dependency exists there.

Resources belong to the operation that acquires them. Use finalizers for file handles,
streams, temporary files, permits, and pending callbacks. Forward cancellation only to
adapters that support it. Cancellation does not make a database write or a remote mutation
safe to replay. Keep domain retry and recovery rules at their existing owners.

## Change rules

1. Put a type in `packages/contracts` only when it crosses a process or application boundary.
2. Put a validation rule beside the contract when all consumers must use the same limit or syntax.
3. Keep provider-specific payloads inside the provider adapter. Translate them at ingestion.
4. Keep database schema changes in the schema module and add migration tests.
5. Keep Electron entry points small. New features use a service or a focused IPC input module.
6. Do not add a second linter or formatter. Biome and its repository-owned anti-slop plugins are the
   only repository lint and format tools.
7. Put renderer state in a domain context module inside that domain's feature directory,
   `src/renderer/src/features/<domain>/<domain>-context.tsx`, beside the logic, views and tests that
   read it, and place it by lifetime: state that belongs to one team server goes inside the keyed scope in
   `app-providers.tsx`, everything else above it. A server switch discards and rebuilds that scope,
   so it is the only per-server teardown there is - a signal on the wrong side of that boundary
   either survives a switch it should not or dies in one it should not, and no list of setters can
   fix it. A context reaches another one with `use*()` only downwards, in the nesting order of
   `app-providers.tsx`, or through a provider prop; a command that writes to several domains lives
   in a leaf context or a bridge component mounted under all of them. Views, contexts and stores
   do not read `window.openbot`. They call a `<domain>-port.ts` module, which lists the bridge calls
   its domain makes, or a narrow API object that a caller can replace (`conversation-runtime.ts`,
   `provider-key-api.ts`). Cycles are rejected by `noImportCycles`, so an upward edge must be
   `import type`.
   Prefer one store per concern inside a context over a signal per field: a row of parallel signals
   is what lets a screen be loading, loaded, and errored at once.
8. Read those contexts from the smallest component that needs them. A pane calls the `use*()` of the
   domains it renders and nothing else; `WorkspaceShell` reads only what decides *which* pane
   renders, and passes a value down as a prop when two of them would otherwise derive it twice. A
   component that assembles another one's props is how the god controller grew back last time.
9. Do not add temporary compatibility paths without a removal condition and a test for that condition. Released Team API protocol adapters are permanent by default and follow the policy below.
10. Log through `@openbot/logging` (`ts-log` Logger), never bare `console.*` - Biome's `noConsole`
    enforces this in `src`, `scripts` and `packages`. The remote-desktop build recipe files listed in
    the `Require a recipe version bump` step of `.github/workflows/remote-desktop-runtime.yml` are
    exempt: any edit to them, cosmetic or not, forces `remoteDesktop.recipeVersion` up and a full
    native runtime rebuild, so their logging is frozen until the recipe changes for a real reason. Every line is timestamped, prefixed and
    secret-redacted, and redaction covers a serialized payload passed as one string, not only a
    structured param. Patterns cannot find a secret with no label, such as a token in an error
    text, so a store that loads a secret passes the value to `registerSecretValue`, and every later
    line masks that exact value. The provider credential store and the MCP store (for header and
    environment names that look secret) do this. `info` and above is written by default; `OPENBOT_LOG_LEVEL` lowers the
    threshold. Machine-readable stdout (piped JSON, tags, harness URLs) uses
    `process.stdout.write` with a `// Machine-readable:` comment instead. Dev automation
    (`scripts/dev-automation`, `bun run dev:automation`) drives the already-running dev app over its
    remote-debugging CDP port and never launches a second instance, seeds, or resets the dev profile.
    Because several worktrees run dev side by side, each instance publishes its worktree, profile,
    renderer port and debugging port to a registry in the dev runtime directory
    (`devRuntimeDirectory()` in `src/main/development-runtime-directory.ts`,
    `scripts/dev-automation/instance-registry.ts`). That directory does not follow `TMPDIR`, which can
    differ from one shell to the next, so every command reads the registry the stack wrote to. The
    file in which a dev host hands its test client the connection is there too, one for each stack.
    Automation resolves the record of the worktree it runs in, verifies the renderer port and the `window.openbot` preload bridge before driving a
    page, and refuses `click` or `type` on an instance it only inferred. A second registry beside it
    (`scripts/dev-automation/stack-registry.ts`) records every port and pid a whole dev stack holds,
    Storybook included, and `scripts/dev-automation/port-allocation.ts` serializes read, choose and
    publish behind one machine-wide lock: probing a port and binding it seconds later is a check
    followed by a use, so two runners starting together both used to win 5173 and the unsuffixed
    `OpenBot Dev` profile with it. Ownership of that lock is a generation rather than a path: taking
    it means creating the next numbered file with an exclusive create, so who owns it is decided by
    a step the kernel makes atomic and never by a delete. Once a lock path exists it stays, and nothing ever
    frees it: releasing replaces the contents with a released marker in one `rename` onto the same
    path, and a lock whose holder has died is superseded where it lies. An allocator asks for the
    highest generation it saw plus one, so anything that frees a path - deleting it, or renaming it
    aside - lets that number be handed out again beside a plan already made against it. A holder
    that is still running is never moved past, however long it has held it. Reading a registry is
    the same shape and holds to the same rule: a record whose processes are gone is filtered out of
    every read, so its ports are free from that moment, but the file is never deleted by the reader
    that judged it - the supervisor may have republished it with a detached child in between, and a
    sibling worktree on a newer branch writes records this checkout cannot parse at all.
    `bun run dev:forget` is what removes a record, because a developer asking for it is a decision
    rather than a guess. It drops the instance records of the stack it forgets, and a pid is not an
    identity: an instance record is stored under its pid, so the app that recycles one writes over
    the record of the app that had it. Each record dates itself, so the worktree and the recorded
    start time decide whose it is, and a live instance is never a dead stack's. `bun run dev:status` and `bun run dev:stop`
    (`scripts/dev-stack.ts`) read those pids instead of matching a process name, which is what makes
    stopping one worktree's stack leave the others alone. Every dev window stays
    reachable: `pages` lists the targets and `--page=<target-id|url-substring>` drives any of them, so
    the app window is the default rather than a limit. Page URLs reach the diagnostics and the
    snapshot document only through `describeTarget`.

SQLite migration history starts at the frozen version 8 compatibility baseline. Keep the baseline
schema unchanged, append every later migration in numeric order, and update the separate latest
schema used for new databases. Never remove or rewrite a migration that may have shipped.

At startup, chat recovery reads all saved provider sessions for each thread, including inactive
sessions from an upgrade or a provider change. It uses each session's provider and merges the
messages into SQLite without activating the old session. A failed read reports an error, keeps
the saved messages, and can be tried again when the provider connects or the app restarts.

## Required verification

Run the narrowest relevant test and lint the changed files. The pre-commit hook runs `check:ui` and
the typecheck of each project that a staged file affects, and CI runs the remaining checks. See [AGENTS.md, Checks](../../AGENTS.md#checks)
for the local rules, and [check design notes](../development-checks.md#check-coverage) for what each CI
job covers.

The Storybook CI job builds all stories with `OPENBOT_STORYBOOK_CHECK=true`. This skips Solid's
automatic prop documentation analysis. The job checks compilation and does not publish its output.
Local Storybook keeps this analysis. Both paths use one Solid compiler plugin.

The browser smoke check also supports `--scenario=wait-deadlines`. These checks wait for the tab's
operation queue to clear before measuring a new deadline. A timed-out call can return while its
CDP commands still need to finish, and that cleanup is outside the next operation's deadline.

Each TypeScript project writes its own ignored `.tsbuildinfo` cache beside its configuration.
Each worktree starts with no cache. The first check creates these files; later checks reuse them
and check changed inputs. Delete the cache files to force fresh checks. A new CI checkout also
starts with no cache unless the CI job restores one. The aggregate commands keep all projects in
parallel. Project scopes and compiler worker settings stay the same.

Changes to packaging, native modules, or Electron security also require the applicable macOS and
Windows package verification commands. Live provider and team smoke tests use isolated temporary
data and are manual because they can require local credentials.
