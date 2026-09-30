-- New table only. The Worker that runs before this deploy does not read it.
-- Which OpenBot host answers each Slack workspace that installed the OpenBot Slack app. Signal routes
-- a workspace's events to that host. No Slack token is kept here: the host has the bot token.
CREATE TABLE slack_workspace_routes (
  team_id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES remote_hosts(host_id) ON DELETE CASCADE,
  -- The account that connected the workspace. Only this account can move it to another host.
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  bot_user_id TEXT NOT NULL,
  connected_at INTEGER NOT NULL
);

CREATE INDEX slack_workspace_routes_host ON slack_workspace_routes(host_id);
