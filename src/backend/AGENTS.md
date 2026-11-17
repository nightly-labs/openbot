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
  Add the new version to `openbot-database-schema-history.json`: the parity test fails and prints
  the entry to add. A red test on a recorded version means a shipped migration changed. Change the
  migration back; do not change its entry.
- A migration change needs data-preservation fixtures for every affected released schema, plus
  failure, rollback, retry, downgrade, missing-version, foreign-key and integrity coverage at the
  stable database boundary.
- No automatic full-database backups: conversation history lives in SQLite, so their time and disk
  cost is unbounded. Make the migration itself safe instead.

### The two build paths

`openbot-database-schema.ts` builds a database twice. `createLatestDatabase` execs
`LATEST_SCHEMA_SQL` and then stamps every entry in `MIGRATIONS` as applied **without running it**;
an existing database runs them for real. A DDL migration that is not also mirrored by hand into
`LATEST_SCHEMA_SQL` therefore ships new installs a database missing that column while upgraded
installs get it, silently, on the user's machine.

`openbot-database-schema-parity.test.ts` builds a database both ways and compares the normalised
`sqlite_master` SQL and `PRAGMA table_info` per table, so that divergence is a red test rather than a
support ticket. Do not weaken it; a new DDL migration means editing `LATEST_SCHEMA_SQL` in the same
change.

### The migration harness

`released-schema-upgrade-migration.test.ts` upgrades the database of every shipped release to the
latest version: the new-install schema and the upgraded schema of each release, and each shipped
version that this build's migrations make. The harness (`migration-harness.ts`) puts rows in every
table, and the test checks that each row is kept or changed as the migration says. It also checks that
`integrity_check`, `foreign_key_check` and the full-text index are clean, that the schema is the same as
a new install's, and that a second start changes nothing.

- The released schemas come from the release tags, not from this build:
  `released-schemas/releases.json`. A release that does not change the schema does not change the
  file. After a release that does, the `Check` job of CI fails (`--check`) until you run
  `bun scripts/released-schema-fixtures.ts`. Do not edit the file by hand.
- A migration that changes, moves or deletes rows adds a function for its version to `ROW_CHANGES` in
  `migration-harness.ts`. The function makes the same change on the rows that the test read before the
  upgrade. A row that only a new value can trigger (an active session, a repeated event) goes in
  `ROW_VALUES`. Without these, the test fails on the changed rows; do not loosen the comparison.
- A new table gets generic rows from its columns and CHECK rules. Add a `ROW_VALUES` entry only when a
  CHECK ties two columns together.
- Keep the focused migration test of each version: the harness proves that nothing else is lost, not
  every case of one migration.

### Large tables

One user database is 17 GB: `orchestration_events` 11.9 GB, `provider_history_staging` 2.9 GB, and
`projection_thread_messages`. Nothing copies the file first, so a migration runs on that file on the
user's computer, and it must finish with the disk that is free.

- Do not rebuild, rewrite every row of, or `VACUUM` because of a large table unless the change needs
  it. Prefer `ADD COLUMN` with no default or a constant default, a new table, or a partial index.
- A `VACUUM` (`vacuumAfterCommit`) needs about two times the file size of free disk: a temporary copy,
  then the WAL. Use it only after a migration deletes a large part of the file.
- A migration that changes a large table, or rewrites or deletes many of its rows, runs
  `bun scripts/migration-large-db-e2e.ts --from=<last shipped version>` and puts the time, peak disk
  and peak memory of its step in the PR. The default is 1.5 GB; `--full` makes 17 GB, which is for CI or
  a server only. `Release upgrade history` runs the 1.5 GB size each week. The parity test fails for a
  new migration that alters, rebuilds or indexes a large table until its version is in
  `MEASURED_LARGE_TABLE_CHANGES`. Data-only rewrites leave no trace in the schema history, so review
  covers them.

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
