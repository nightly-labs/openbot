import type { OpenBotMigration } from "./migration";

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
  up: (db) => db.exec(MESSAGING_ALLOWED_ROLES_SCHEMA_SQL),
};
