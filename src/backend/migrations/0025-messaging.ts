import type { OpenBotMigration } from "./migration";

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

export const migration: OpenBotMigration = {
  version: 25,
  name: "messaging",
  up: (db) => db.exec(MESSAGING_SCHEMA_SQL),
};
