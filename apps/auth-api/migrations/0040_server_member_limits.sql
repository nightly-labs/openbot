CREATE TABLE IF NOT EXISTS server_member_limits (
  server_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_limit INTEGER NOT NULL CHECK(typeof(member_limit) = 'integer' AND member_limit BETWEEN 1 AND 100),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS server_member_limits_owner ON server_member_limits(owner_user_id);
