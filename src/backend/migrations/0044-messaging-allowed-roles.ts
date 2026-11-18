import type { OpenBotMigration } from "./migration";

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

export const migration: OpenBotMigration = {
  version: 44,
  name: "messaging-allowed-roles",
  // Only creates a table, so no foreign-key pause and no vacuum. No connection has a role list yet, so
  // everyone can still mention OpenBot, which is what they could before.
  up: (db) => db.exec(MESSAGING_ALLOWED_ROLES_SCHEMA_SQL),
};
