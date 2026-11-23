CREATE TABLE slack_workspace_routes (
  team_id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES remote_hosts(host_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  bot_user_id TEXT NOT NULL,
  connected_at INTEGER NOT NULL
);

CREATE INDEX slack_workspace_routes_host ON slack_workspace_routes(host_id);
