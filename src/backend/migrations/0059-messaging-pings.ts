import type { OpenBotMigration } from "./migration";

export const MESSAGING_PINGS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_messaging_pings (
    connection_id TEXT NOT NULL REFERENCES projection_messaging_connections(connection_id),
    platform_channel_id TEXT NOT NULL,
    thread_key TEXT NOT NULL,
    user_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (connection_id, platform_channel_id, thread_key, user_id)
  );
`;

export const migration: OpenBotMigration = {
  version: 59,
  name: "messaging-pings",
  up: (db) => db.exec(MESSAGING_PINGS_SCHEMA_SQL),
};
