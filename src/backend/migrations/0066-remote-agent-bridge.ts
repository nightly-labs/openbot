import type { OpenBotMigration } from "./migration";

export const REMOTE_AGENT_BRIDGE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS remote_agent_bridge_invites (
    invite_id TEXT PRIMARY KEY,
    secret_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    reach TEXT NOT NULL,
    server_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE TABLE IF NOT EXISTS remote_agent_bridge_links (
    link_id TEXT PRIMARY KEY,
    peer_name TEXT NOT NULL,
    peer_reach TEXT NOT NULL,
    peer_token_hash TEXT NOT NULL,
    token_ciphertext BLOB NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_remote_agent_bridge_links_token
    ON remote_agent_bridge_links(peer_token_hash);
`;

export const migration: OpenBotMigration = {
  version: 66,
  name: "remote-agent-bridge",
  up: (db) => db.exec(REMOTE_AGENT_BRIDGE_SCHEMA_SQL),
};
