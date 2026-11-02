// Shared by migration v25 and the separate new-database schema. IF NOT EXISTS throughout, because
// this text is both the migration and the tail of the latest schema.
//
// `platform` has no CHECK on purpose: the next platform must not need a table rebuild, which is
// what a CHECK change costs (migrations 17, 22 and 23). The code only accepts the platforms it has
// a driver for.
//
// A connection is one workspace of a platform, such as a Slack workspace that installed the OpenBot
// app. Its orchestrator agent receives each new conversation and asks its teammates. No token is
// stored here. The tokens of a connection live in the main process's
// encrypted credential file, keyed by `connection_id`.
//
// A messaging thread is an execution thread of the agent that answers it, like a channel context:
// its own row in `projection_threads`, which the agent's public chat never shows.
export const MESSAGING_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_messaging_connections (
    connection_id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    workspace_name TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
    bot_user_id TEXT,
    app_id TEXT,
    orchestrator_agent_id TEXT,
    last_error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(platform, workspace_id)
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

// Shared by migration v36 and the separate new-database schema. IF NOT EXISTS throughout.
//
// Facts that agents save about one connection (a Slack workspace, a Discord server, a Telegram chat)
// with messaging_remember. Every conversation of the connection sees them; the OpenBot user's own
// chats and the agents' private memories do not. The columns mirror `projection_channel_memories`,
// because one store implementation serves every owner. No CASCADE: no code deletes a connection
// (disconnect only disables it), and code that does must purge these rows and their
// `messaging-memory` events first.
export const MESSAGING_MEMORY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_messaging_memories (
    memory_id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES projection_messaging_connections(connection_id),
    text TEXT NOT NULL,
    normalized_text TEXT NOT NULL,
    origin TEXT NOT NULL CHECK(origin IN ('automatic', 'manual')),
    source_turn_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_event_sequence INTEGER NOT NULL,
    UNIQUE(connection_id, normalized_text)
  );
  CREATE INDEX IF NOT EXISTS messaging_memories_connection
    ON projection_messaging_memories(connection_id, updated_at DESC, memory_id);
`;

// Shared by migration v44 and the separate new-database schema. IF NOT EXISTS throughout.
//
// The Discord roles whose members can use OpenBot in one connection. A connection with no row lets
// everyone. The name is the one the user chose from, kept so the setting reads the same when a role
// is gone. Configuration, written directly. No CASCADE, as for memories: disconnect keeps the rows.
export const MESSAGING_ALLOWED_ROLES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_messaging_allowed_roles (
    connection_id TEXT NOT NULL REFERENCES projection_messaging_connections(connection_id),
    role_id TEXT NOT NULL,
    role_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (connection_id, role_id)
  );
`;
