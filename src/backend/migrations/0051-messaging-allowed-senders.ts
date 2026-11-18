import type { OpenBotMigration } from "./migration";

// Shared by migration v51 and the separate new-database schema. IF NOT EXISTS throughout.
//
// The WhatsApp contacts and groups that can give work in one connection, beside the owner's own chat.
// `sender_id` is the phone number in digits for a contact and the group JID for a group. The name is
// the one the owner saw when they added it. Configuration, written directly. No CASCADE, as for roles:
// disconnect keeps the rows, so a number linked again keeps its list.
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
  // Only creates a table, so no foreign-key pause and no vacuum. No WhatsApp connection exists before
  // it, so no connection loses senders.
  up: (db) => db.exec(MESSAGING_ALLOWED_SENDERS_SCHEMA_SQL),
};
