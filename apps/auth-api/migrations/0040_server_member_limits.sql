-- A new table only. The Worker that runs before this deploy does not read it.
-- A member limit for one server, such as an enterprise customer's. When a row exists, its limit
-- replaces the limit of the server's plan, or the default of a server with no plan. Staff add and
-- change rows by hand; no route writes them.
-- The row applies only while its account owns the server, as a plan does: the remote host or the
-- hosted server row must have the same owner. The key has no reference to remote_hosts, so the row
-- stays when the owner deletes the host and registers it again, and applies to a hosted server before
-- it publishes its host. Another account that registers the same ID gets nothing. The rows stop with
-- their account.
-- 100 is the most members that a host stores (INPUT_LIMITS.teamMembers).
CREATE TABLE IF NOT EXISTS server_member_limits (
  server_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_limit INTEGER NOT NULL CHECK(typeof(member_limit) = 'integer' AND member_limit BETWEEN 1 AND 100),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS server_member_limits_owner ON server_member_limits(owner_user_id);
