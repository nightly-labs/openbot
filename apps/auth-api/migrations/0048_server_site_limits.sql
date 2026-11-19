CREATE TABLE IF NOT EXISTS server_site_limits (
  server_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_limit INTEGER NOT NULL CHECK(typeof(site_limit) = 'integer' AND site_limit BETWEEN 1 AND 1000),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS server_site_limits_owner ON server_site_limits(owner_user_id);
