CREATE TABLE IF NOT EXISTS remote_owner_transfers (
  transfer_id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_email TEXT NOT NULL,
  to_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  host_session_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS remote_owner_transfers_pending_host
  ON remote_owner_transfers(host_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS remote_owner_transfers_pending_email
  ON remote_owner_transfers(to_email, expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS remote_owner_transfers_accepted_host
  ON remote_owner_transfers(host_id, from_user_id) WHERE status = 'accepted';
