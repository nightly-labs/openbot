-- Route ownership only. The host keeps the webhook source secret and event data locally; this table
-- lets Signal confirm that an opaque public route ID belongs to this host and account.
-- A revoked route keeps its row with `revoked_at` set, and a host or account delete does not remove
-- it: senders can still post to the old public URL, so its ID must never belong to another host.
CREATE TABLE webhook_routes (
  route_id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  connected_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX webhook_routes_host ON webhook_routes(host_id) WHERE revoked_at IS NULL;
