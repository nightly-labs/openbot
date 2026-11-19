import type { DatabaseSync } from "node:sqlite";
import type { OpenBotMigration } from "./migration";
import { isDynamicRecord, isString } from "./runtime-values";

const V17_PROVIDER_SESSIONS_CHECK_SQL = `provider TEXT NOT NULL CHECK(provider IN ('codex', 'claude', 'grok', 'opencode')),`;

export function migrateProviderSessionsForOpencode(db: DatabaseSync): void {
  widenProviderSessionsCheck(db, "'opencode'", V17_PROVIDER_SESSIONS_CHECK_SQL, "projection_provider_sessions_v17");
}

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
  disableForeignKeys: true,
  up: migrateProviderSessionsForOpencode,
};
