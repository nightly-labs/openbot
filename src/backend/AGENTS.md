# `src/backend`

The stores, the SQLite database (`openbot-database.ts` and the controllers under `database/`), the
provider clients and `agent-service.ts`. The user's SQLite is the source of truth here, not a cache
of something remote — which is what makes the first section below non-negotiable.

## Database migrations

- Nothing copies `openbot.db` before an upgrade. Every migration is an irreversible production data
  operation: preserve all user data, support every shipped source schema, never depend on a backup.
- Keep each schema change and its `schema_migrations` marker in one transaction. Roll back on any
  error, restore foreign-key enforcement in `finally`, and run the integrity checks before startup
  continues.
- Never edit or delete a migration that may have shipped, including the frozen version 8 baseline.
  Append the next contiguous version and update the separate latest schema for new databases.
  See [Frozen migrations](#frozen-migrations).
  Add the new version to `openbot-database-schema-history.json`: the parity test fails and prints
  the entry to add. A red test on a recorded version means a shipped migration changed. Change the
  migration back; do not change its entry.
- A migration change needs data-preservation fixtures for every affected released schema, plus
  failure, rollback, retry, downgrade, missing-version, foreign-key and integrity coverage at the
  stable database boundary.
- No automatic full-database backups: conversation history lives in SQLite, so their time and disk
  cost is unbounded. Make the migration itself safe instead.

### Frozen migrations

Each migration is one file in `migrations/`: `<4-digit version>-<name>.ts`, which exports
`migration` with the same `version` and `name`. `migrations/registry.ts` lists them in order.
`bun run check:migrations` (CI job Check) compares the folder with the newest `v*` release tag:

- A file that the tag has must not change, move or go away. `registry.ts` and the `migration.ts`
  type are the only exceptions. This includes helpers in a migration file and `runtime-values.ts`.
- A new migration takes a version above the newest released one. Versions are contiguous from 8,
  and names are unique.
- A migration file imports only `node:*`, `@openbot/logging`, `./migration`, `./runtime-values` and
  earlier migrations. Copy any other code into the file, so a change to live code cannot change a
  released migration.

To fix a bug in a released migration, do not edit it. Add a new migration that repairs each
database that the bad one made, and keep it safe for databases that the bad one did not touch. Give
it fixtures for every affected released schema. An unreleased migration can still change.

### The two build paths

`openbot-database-schema.ts` builds a database twice. `createLatestDatabase` execs
`LATEST_SCHEMA_SQL` and then stamps every entry in `MIGRATIONS` (`migrations/registry.ts`) as
applied **without running it**;
an existing database runs them for real. A DDL migration that is not also mirrored by hand into
`LATEST_SCHEMA_SQL` therefore ships new installs a database missing that column while upgraded
installs get it, silently, on the user's machine.

`openbot-database-schema-parity.test.ts` builds a database both ways and compares the normalised
`sqlite_master` SQL and `PRAGMA table_info` per table, so that divergence is a red test rather than a
support ticket. Do not weaken it; a new DDL migration means editing `LATEST_SCHEMA_SQL` in the same
change.

The account service has a second, unrelated database — Cloudflare D1 — and its rule is the opposite
shape: those migrations are reversible but race a deploy. `apps/auth-api/AGENTS.md` owns it — nothing in this
directory touches `apps/auth-api/migrations/`.

## Size

`mailbox-store.ts` owns mailbox state and database writes. `attachment-files.ts` owns draft and
transfer file operations; it must not import `MailboxStore` or write database state. Keep the staged
generated-attachment map in the store. Apply it to mailbox state only after the atomic conversation
and mailbox commit succeeds. Keep deletion-outbox completion in the store, after file removal.

The two that used to be larger are both worth copying. `agent-service.ts` was split into one
controller per concern, each constructed and owned by the service; `openbot-database.ts` was split
into modules under `database/`, leaving a ~560-line facade that had to keep its class name, instance
identity, constructor signature and public surface because callers reach past it into `connection`
and `dispatch`. The shape in both: one class per file, kebab-case, `<Name>Options` + `<Name>`,
`readonly #` fields, a constructor that only assigns, and a doc comment saying what the class
**owns** and that it never imports the facade. No barrel file.

Two rules those controllers depend on and a reader cannot infer. They hold the core object and read
`.connection` at each use — a cached handle survives `initialize()` and then silently addresses a
closed database after `close()`. And a projection controller does not open a transaction of its own.
Four places do, and each is load-bearing: `dispatch` and `deleteEventsAndReceipt` open one only if
they find none open, which is what lets a projector nest another dispatch inside the caller's, and
`ThreadReplay.rebuildThreadProjection` and the facade's `persistConversationAndMailbox` open one
unconditionally, which is what makes the dispatch inside each of them skip its own. Open an
unconditional one anywhere else and a caller already in a transaction gets a nested `BEGIN` that
SQLite rejects; remove one of these four and the replay or the mailbox write silently stops being
atomic.

Do not add a new concern to the biggest file you can see; extract one when a change gives you the
excuse.

## The database host process

`agent-data/agent-database-host.ts` is the entry of a separate process, and the only file here that
touches the agents' shared SQLite files. Two rules keep it that way.

**Its runtime imports are limited to `node:*` and `effect`.** Every repository reference in it is an `import
type`, which both the bundler and Node's type stripping erase. The Effect v4 migration explicitly permits Effect; no other runtime dependency is allowed.
This keeps Electron and the `openbot.db` facade out of the host, and it lets a test spawn the `.ts` source under a
real `node` and drive the true host instead of a fake.

**Its isolation is the process, not a thread.** `sqlite3_step` never returns to JavaScript, so a
worker ignores `terminate()` and only a killable process bounds a runaway statement. The supervisor
sends SIGKILL on the deadline and re-dispatches the queued work to a fresh host. A packaged build
ships the `runAsNode: false` fuse, so the production host is an Electron `utilityProcess` rather
than `process.execPath` run as Node; `AgentDatabaseHostProcess` is the seam that carries both.
