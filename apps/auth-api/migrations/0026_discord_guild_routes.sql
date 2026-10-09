-- New table only. The Worker that runs before this deploy does not read it.
-- Which OpenBot host answers each Discord server (guild) that added the OpenBot Discord app. Signal
-- routes a guild's events to that host. No Discord token is kept here: only Signal has the bot token.
CREATE TABLE discord_guild_routes (
  guild_id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES remote_hosts(host_id) ON DELETE CASCADE,
  -- The account that connected the guild. Only this account can move it to another host.
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connected_at INTEGER NOT NULL
);

CREATE INDEX discord_guild_routes_host ON discord_guild_routes(host_id);
