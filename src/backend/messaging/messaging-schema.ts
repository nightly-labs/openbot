// Shared by migration v25 and the separate new-database schema. IF NOT EXISTS throughout, because
// this text is both the migration and the tail of the latest schema.
//
// `platform` has no CHECK on purpose: the next platform must not need a table rebuild, which is
// what a CHECK change costs (migrations 17, 22 and 23). The code only accepts the platforms it has
// a driver for.
//
// No token is stored here. The tokens of a connection live in the main process's encrypted
// credential file, keyed by `connection_id`.
//
// A messaging thread is an execution thread of the agent, like a channel context: its own row in
// `projection_threads`, which the agent's public chat never shows.
export const MESSAGING_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_messaging_connections (
    connection_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
    workspace_id TEXT,
    workspace_name TEXT,
    bot_user_id TEXT,
    app_id TEXT,
    last_error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(agent_id, platform)
  );
  CREATE TABLE IF NOT EXISTS projection_messaging_threads (
    link_id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES projection_messaging_connections(connection_id),
    agent_id TEXT NOT NULL,
    platform_channel_id TEXT NOT NULL,
    thread_key TEXT NOT NULL,
    is_direct INTEGER NOT NULL CHECK(is_direct IN (0, 1)),
    thread_id TEXT NOT NULL UNIQUE REFERENCES projection_threads(thread_id),
    title TEXT NOT NULL,
    history_cursor TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(connection_id, platform_channel_id, thread_key)
  );
  CREATE INDEX IF NOT EXISTS messaging_threads_agent ON projection_messaging_threads(agent_id, updated_at DESC);
`;
