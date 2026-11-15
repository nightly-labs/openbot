import type { OpenBotMigration } from "./migration";

// Invites and links for agents on another host. An invite stores the hash of its secret, not the
// secret. A link stores the hash of the token the peer uses to call this host, and the ciphertext
// of the token this host uses to call the peer. The main process encrypts that token. This text is
// both the migration and the tail of the latest schema, so it imports nothing from live code.
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
  // Only creates tables and their indexes, so no foreign-key pause and no vacuum. No host was linked
  // before it, so the tables start empty and every mailbox sender stays user, agent, or routine.
  up: (db) => db.exec(REMOTE_AGENT_BRIDGE_SCHEMA_SQL),
};
