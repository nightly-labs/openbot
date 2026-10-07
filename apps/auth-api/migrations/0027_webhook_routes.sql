-- Route ownership only. The host keeps the webhook source secret and event data locally; this table
-- lets Signal confirm that an opaque public route ID belongs to this host and account.
CREATE TABLE webhook_routes (
  route_id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES remote_hosts(host_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connected_at INTEGER NOT NULL
);

CREATE INDEX webhook_routes_host ON webhook_routes(host_id);
