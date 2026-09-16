// Shared by migration v21 and the separate new-database schema. IF NOT EXISTS throughout, because
// this text is both the migration and the tail of the latest schema: a database built from the
// latest schema and then replayed forward - which is how a test fakes an older version - meets its
// own tables.
export const WATCHER_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_agent_watchers (
    watcher_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    routine_id TEXT NOT NULL REFERENCES projection_agent_routines(routine_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    active INTEGER NOT NULL CHECK(active IN (0, 1)),
    interval_minutes INTEGER NOT NULL CHECK(interval_minutes >= 3 AND interval_minutes <= 1440),
    source_json TEXT NOT NULL CHECK(json_valid(source_json)),
    selector_json TEXT CHECK(selector_json IS NULL OR json_valid(selector_json)),
    condition_json TEXT NOT NULL CHECK(json_valid(condition_json)),
    health TEXT NOT NULL CHECK(health IN ('ok', 'weak', 'quarantined')),
    last_checked_at TEXT,
    next_check_at TEXT NOT NULL,
    last_state_hash TEXT,
    error_count INTEGER NOT NULL DEFAULT 0 CHECK(error_count >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_event_sequence INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS agent_watchers_agent
    ON projection_agent_watchers(agent_id, updated_at DESC, watcher_id);
  CREATE INDEX IF NOT EXISTS agent_watchers_due
    ON projection_agent_watchers(next_check_at, watcher_id);
  CREATE TABLE IF NOT EXISTS projection_agent_watcher_matches (
    match_id TEXT PRIMARY KEY,
    watcher_id TEXT NOT NULL REFERENCES projection_agent_watchers(watcher_id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    diff TEXT NOT NULL,
    consumed_run_id TEXT,
    created_at TEXT NOT NULL,
    last_event_sequence INTEGER NOT NULL,
    UNIQUE(watcher_id, source_id)
  );
  CREATE INDEX IF NOT EXISTS agent_watcher_matches_watcher
    ON projection_agent_watcher_matches(watcher_id, created_at DESC, match_id);
`;

// Shared by migration v22 and the separate new-database schema. Nullable columns only, so old
// rows survive without backfill: prior kept text and check mode arrive empty and fill on the
// next check.
export const WATCHER_CHECK_STATE_SCHEMA_SQL = `
  ALTER TABLE projection_agent_watchers ADD COLUMN last_kept_text TEXT;
  ALTER TABLE projection_agent_watchers ADD COLUMN last_mode TEXT CHECK(last_mode IN ('fetch', 'browser', 'gmail'));
`;
