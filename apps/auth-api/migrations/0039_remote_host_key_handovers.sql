CREATE TABLE IF NOT EXISTS remote_host_key_handovers (
  handover_id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES remote_hosts(host_id) ON DELETE CASCADE,
  issued_at INTEGER NOT NULL CHECK(issued_at >= 0),
  previous_public_key TEXT NOT NULL,
  public_key TEXT NOT NULL CHECK(public_key <> previous_public_key),
  previous_signature TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(host_id, signature)
);

CREATE INDEX IF NOT EXISTS remote_host_key_handovers_host ON remote_host_key_handovers(host_id, issued_at);
