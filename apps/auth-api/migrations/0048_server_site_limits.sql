-- A new table only. The Worker that runs before this deploy does not read it.
-- An active-site limit for one server, such as an enterprise customer's. When a row exists, its limit
-- replaces the site limit of the server's plan, or the default of a server with no plan. Staff add and
-- change rows by hand; no route writes them. The unlinked bucket of an account has no row.
-- The row applies only while its account owns the server, as a plan does: the remote host or the
-- hosted server row must have the same owner. The key has no reference to remote_hosts, so the row
-- stays when the owner deletes the host and registers it again, and applies to a hosted server before
-- it publishes its host. Another account that registers the same ID gets nothing. The rows stop with
-- their account.
-- 1000 bounds the storage of one server: each site holds at most 2 MB.
CREATE TABLE IF NOT EXISTS server_site_limits (
  server_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_limit INTEGER NOT NULL CHECK(typeof(site_limit) = 'integer' AND site_limit BETWEEN 1 AND 1000),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS server_site_limits_owner ON server_site_limits(owner_user_id);
