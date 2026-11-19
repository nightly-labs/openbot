import type { OpenBotMigration } from "./migration";

export const MCP_SERVERS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_mcp_servers (
    mcp_server_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    transport TEXT NOT NULL CHECK(transport IN ('stdio', 'http')),
    enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
    command TEXT NOT NULL,
    args_json TEXT NOT NULL CHECK(json_valid(args_json)),
    env_json TEXT NOT NULL CHECK(json_valid(env_json)),
    env_passthrough_json TEXT NOT NULL CHECK(json_valid(env_passthrough_json)),
    working_directory TEXT NOT NULL,
    url TEXT NOT NULL,
    headers_json TEXT NOT NULL CHECK(json_valid(headers_json)),
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS mcp_servers_order ON projection_mcp_servers(position, mcp_server_id);
  CREATE UNIQUE INDEX IF NOT EXISTS mcp_servers_name ON projection_mcp_servers(name);
`;

export const migration: OpenBotMigration = {
  version: 20,
  name: "mcp-servers",
  up: (db) => db.exec(MCP_SERVERS_SCHEMA_SQL),
};
