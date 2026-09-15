// Shared by migration v20 and the separate new-database schema. IF NOT EXISTS throughout, because
// this text is both the migration and the tail of the latest schema.
//
// The table is deliberately not keyed by a server id. This database holds the configuration of this
// machine's host; a remote server's list lives in that host's own database and is read over the
// wire. "Per server" is realised by routing, not by a column that would always read `local`.
//
// The arrays are JSON text rather than child tables: the app always reads a record whole, and the
// row order the user typed is meaningful. `CHECK(json_valid(...))` follows
// `projection_channel_routine_triggers.schedule_json`.
//
// The unique name is load-bearing, not cosmetic. All four providers key MCP servers by name, so two
// rows sharing one name would silently collapse into one server at spawn.
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
