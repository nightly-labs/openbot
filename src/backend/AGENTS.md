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
  Append the next contiguous version; a new database runs it too ([One build path](#one-build-path)).
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
- A migration file imports only `node:*`, `@openbot/logging`, `./runtime-values`, earlier migrations,
  and types (`import type`) from `./migration`. Copy any other code into the file, so a change to live
  code cannot change a released migration.

To fix a bug in a released migration, do not edit it. Add a new migration that repairs each
database that the bad one made, and keep it safe for databases that the bad one did not touch. Give
it fixtures for every affected released schema. An unreleased migration can still change.

### One build path

A new database runs the same migrations as an existing one. `migrateOpenBotDatabase` sees an empty file
and runs every entry of `MIGRATIONS` from the version 8 baseline, which creates each table with
`IF NOT EXISTS`. So there is no second schema to update, and a new install cannot miss a column that an
upgraded install has. A new database skips `vacuumAfterCommit`: it has no free pages.

`openbot-database-schema-parity.test.ts` builds a new database from an empty file and compares it with
the schema that `openbot-database-schema-history.json` records, version by version. Do not weaken it.
Databases that an older release made for a new install (from its separate `LATEST_SCHEMA_SQL`) are
in `released-schemas/releases.json`, and the migration harness upgrades them.

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
After start, OpenBot replaces each imported Codex and Claude row of `provider_history_staging` with a
hash, in small transactions, only at schema 64 or later: an older release cannot read a hash row, so
the marker migration 64 makes it refuse the file. The file keeps its size; SQLite uses the free pages again.
After that, it removes from each old thread event the `changedMessages` items that a replay does not
need (`database/thread-event-compaction.ts`): one thread at a time, in small transactions, with each
done thread in `thread_event_compaction` (migration 65, which older releases refuse). It also deletes a
generated `conversation.snapshot-updated` row when, for each message of the row, a later update of that
message has all its keys, so the replay gives the same chat. It runs 1 minute after start and every
6 hours, on the main process, so a batch stops after 25 ms and the run then rests 9 times as long as
it worked. A done thread runs again from its first event when the events after its `through_sequence`
are at least its message count, and at least 1000, and its `compacted_at` is at least 6 hours old, so
the work grows with the thread. The rule uses the replay's own fold
(`database/thread-message-fold.ts`). When you change the fold, run `bun scripts/thread-event-compaction-e2e.ts`.
Each delete finds the activity rows of its event through the index of migration 70
(`projection_thread_activities(thread_id, last_event_sequence)`); without it, one delete reads the
whole table. When you change a delete of activity rows, run `bun scripts/thread-event-compaction-activities-e2e.ts`.

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

## Transactions

- Run each SQLite transaction through `withTransaction` (synchronous work) or `withTransactionAsync`
  (work that awaits) in `database/sqlite-transaction.ts`. The Biome rule `no-raw-sqlite-transaction`
  rejects hand-written `BEGIN`, `COMMIT`, `END`, `ROLLBACK`, `SAVEPOINT` and `RELEASE`.
- A nested `withTransaction` runs in a savepoint. Its error rolls back only its level and is thrown
  again. To keep the caller's writes, catch the error outside the nested call (see `CrmStore.#decide`).
- `withTransactionAsync` never nests. Use it only on a connection with one user at a time, such as the
  Claude history index.
- A migration has no backup. Keep a schema change and its `schema_migrations` marker in one call.

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
`readonly #` fields, and a constructor that only assigns. Each class **owns** one concern and never
imports the facade. No barrel file.

Two rules those controllers depend on and a reader cannot infer. They hold the core object and read
`.connection` at each use — a cached handle survives `initialize()` and then silently addresses a
closed database after `close()`. And a projection controller does not open a transaction of its own.
Four places do, and each is load-bearing: `dispatch` and `deleteEventsAndReceipt` let a projector
nest another dispatch inside the caller's transaction, and `ThreadReplay.rebuildThreadProjection` and
the facade's `persistConversationAndMailbox` hold the dispatch inside each of them in one
transaction. Remove one of these four and the replay or the mailbox write silently stops being
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
