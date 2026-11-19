CREATE TABLE discord_guild_routes (
  guild_id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES remote_hosts(host_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connected_at INTEGER NOT NULL
);

CREATE INDEX discord_guild_routes_host ON discord_guild_routes(host_id);
