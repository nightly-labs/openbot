CREATE TABLE webhook_routes (
  route_id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  connected_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX webhook_routes_host ON webhook_routes(host_id) WHERE revoked_at IS NULL;
