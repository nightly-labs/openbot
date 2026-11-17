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

The account service has a second, unrelated database — Cloudflare D1 — and its rule is the opposite
shape: those migrations are reversible but race a deploy. `apps/auth-api/AGENTS.md` owns it — nothing in this
directory touches `apps/auth-api/migrations/`.

## Transactions

- Run every SQLite transaction through `withTransaction` (synchronous work) or
  `withTransactionAsync` (work that awaits) in `database/sqlite-transaction.ts`. Do not run
  `BEGIN`, `COMMIT`, `END`, `ROLLBACK`, `SAVEPOINT` or `RELEASE` by hand in `src/backend` or
  `src/main`. The Biome rule `no-raw-sqlite-transaction` rejects them.
- The outer call opens `BEGIN IMMEDIATE`. A nested call runs in a savepoint, so it joins the
  caller's transaction. An error rolls back only its own level and is thrown again. The connection
  is never left in a transaction that the helper opened, and a `ROLLBACK` after SQLite already
  rolled back (for example on a full disk) does not hide the first error.
- Do not commit or roll back inside the work. To keep a part of the work after a failure, catch the
  error outside a nested `withTransaction` call: its savepoint is already rolled back (see
  `CrmStore.#decide`).
- `withTransactionAsync` never nests. Another caller can use the connection while the work awaits,
  so use it only on a connection that has one user at a time, such as the Claude history index.
- A migration has no backup to fall back to. A schema change and its `schema_migrations` marker
  stay in one `withTransaction` call.

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
