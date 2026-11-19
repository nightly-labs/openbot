CREATE TABLE server_claims (
  claim_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  session_id TEXT
);

CREATE INDEX server_claims_expires_at ON server_claims(expires_at);
