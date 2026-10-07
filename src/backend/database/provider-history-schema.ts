/**
 * Durable provider history state.
 *
 * Provider history is an import stream, not a replacement for the conversation projection. The
 * import cursor and every item are kept separately so a page that fails halfway through can be
 * retried without deleting messages that were not present in that page.
 */
export const PROVIDER_HISTORY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS provider_history_imports (
    session_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES projection_threads(thread_id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    external_session_id TEXT NOT NULL,
    cursor_json TEXT CHECK(cursor_json IS NULL OR json_valid(cursor_json)),
    state TEXT NOT NULL CHECK(state IN ('pending', 'active', 'complete', 'failed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider, external_session_id)
  );
  CREATE INDEX IF NOT EXISTS provider_history_imports_thread
    ON provider_history_imports(thread_id, provider, state);
  CREATE TABLE IF NOT EXISTS provider_history_turns (
    session_id TEXT NOT NULL REFERENCES provider_history_imports(session_id) ON DELETE CASCADE,
    turn_id TEXT NOT NULL,
    turn_status TEXT,
    turn_started_at INTEGER,
    complete INTEGER NOT NULL CHECK(complete IN (0, 1)),
    imported INTEGER NOT NULL DEFAULT 0 CHECK(imported IN (0, 1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(session_id, turn_id)
  );
  CREATE INDEX IF NOT EXISTS provider_history_turns_pending
    ON provider_history_turns(session_id, imported, turn_id);
  CREATE TABLE IF NOT EXISTS provider_history_staging (
    session_id TEXT NOT NULL REFERENCES provider_history_imports(session_id) ON DELETE CASCADE,
    turn_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    item_index INTEGER NOT NULL,
    item_json TEXT NOT NULL CHECK(json_valid(item_json)),
    imported INTEGER NOT NULL DEFAULT 0 CHECK(imported IN (0, 1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(session_id, turn_id, item_key)
  );
  CREATE INDEX IF NOT EXISTS provider_history_staging_turn
    ON provider_history_staging(session_id, turn_id, item_index, item_key);
  CREATE INDEX IF NOT EXISTS provider_history_staging_pending
    ON provider_history_staging(session_id, imported, turn_id, item_index);
`;
