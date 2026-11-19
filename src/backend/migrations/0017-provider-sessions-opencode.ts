import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord, isString } from "./runtime-values";

const V17_PROVIDER_SESSIONS_CHECK_SQL = `provider TEXT NOT NULL CHECK(provider IN ('codex', 'claude', 'grok', 'opencode')),`;

// The provider list is a CHECK constraint, which SQLite can only widen by rebuilding the table. Guarding
// on the stored SQL rather than on the schema version keeps this a no-op for a database `createLatestDatabase`
// already built with the wider list, which is how a test replays an older version forward over a fresh file.
// The index goes with the table it indexes, so it has to be recreated by name after the rename.
export function migrateProviderSessionsForOpencode(db: DatabaseSync): void {
  widenProviderSessionsCheck(db, "'opencode'", V17_PROVIDER_SESSIONS_CHECK_SQL, "projection_provider_sessions_v17");
}

// Migrations 17, 22, 23, 24 and 26 share this SQL. Each migration gives its own CHECK line and staging table name, so the
// SQL that migration 17 runs is the same text as before this function was shared.
export function widenProviderSessionsCheck(
  db: DatabaseSync,
  providerLiteral: string,
  providerCheckSql: string,
  stagingTable: string,
): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'projection_provider_sessions'")
    .get();
  if (!isDynamicRecord(row) || !isString(row.sql) || row.sql.includes(providerLiteral)) return;
  rebuildProviderSessions(db, providerCheckSql, stagingTable);
}

// The rebuild that migrations 17, 22, 23, 24, 26 and 28 run. `providerColumnSql` is the whole provider column line.
export function rebuildProviderSessions(db: DatabaseSync, providerColumnSql: string, stagingTable: string): void {
  db.exec(`
    CREATE TABLE ${stagingTable} (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
      ${providerColumnSql}
      external_session_id TEXT NOT NULL,
      model TEXT NOT NULL,
      effort TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('active', 'inactive', 'failed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resume_cursor TEXT,
      last_event_sequence INTEGER NOT NULL,
      UNIQUE(provider, external_session_id)
    );
    INSERT INTO ${stagingTable} (
      id, thread_id, provider, external_session_id, model, effort, state,
      created_at, updated_at, resume_cursor, last_event_sequence
    ) SELECT
      id, thread_id, provider, external_session_id, model, effort, state,
      created_at, updated_at, resume_cursor, last_event_sequence
    FROM projection_provider_sessions;
    DROP TABLE projection_provider_sessions;
    ALTER TABLE ${stagingTable} RENAME TO projection_provider_sessions;
    CREATE INDEX provider_sessions_thread
      ON projection_provider_sessions(thread_id, provider, state);
  `);
}

export const migration: OpenBotMigration = {
  version: 17,
  name: "provider-sessions-opencode",
  // `projection_turns.provider_session_id` is a child reference with ON DELETE SET NULL. Dropping the
  // parent with foreign keys on would fire that action and blank the column on every turn ever taken,
  // so the rebuild runs with them off - the same reason migration 13 does.
  disableForeignKeys: true,
  up: migrateProviderSessionsForOpencode,
};
