import type { OpenBotMigration } from "./migration";

export const MESSAGING_ALLOWED_SENDERS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_messaging_allowed_senders (
    connection_id TEXT NOT NULL REFERENCES projection_messaging_connections(connection_id),
    sender_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('contact', 'group')),
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (connection_id, sender_id)
  );
`;

export const migration: OpenBotMigration = {
  version: 51,
  name: "messaging-allowed-senders",
  up: (db) => db.exec(MESSAGING_ALLOWED_SENDERS_SCHEMA_SQL),
};
