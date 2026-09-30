-- One nullable column and one index. The Worker that runs before this deploy does not read them, and its
-- inserts leave the column NULL, which is the unlinked bucket.
-- The server that published a site. NULL: no server was proven, from a desktop that is not a registered
-- server or from a release before sites belonged to servers. No foreign key, the same as
-- billing_subscriptions.server_id: a server can be a Remote host or a hosted server.
ALTER TABLE hosted_sites ADD COLUMN server_id TEXT;

CREATE INDEX hosted_sites_server_status ON hosted_sites(server_id, status, expires_at);
