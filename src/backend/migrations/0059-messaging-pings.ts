import type { OpenBotMigration } from "./migration";

// Shared by migration v59 and the separate new-database schema. IF NOT EXISTS throughout.
//
// The people that an agent's `messaging_post` pinged in a Slack thread. A reply of one of them in that
// thread reaches the orchestrator without a mention; a reply of anyone else needs a mention, also after
// the first reply gives the thread its link. `text` is the redacted post, which the orchestrator gets
// as the message that the first reply answers. No CASCADE, as for roles: disconnect keeps the rows.
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
  // Only creates a table, so no foreign-key pause and no vacuum. No post was recorded as a ping
  // before it, so the table starts empty, and every thread routes its replies as before.
  up: (db) => db.exec(MESSAGING_PINGS_SCHEMA_SQL),
};
