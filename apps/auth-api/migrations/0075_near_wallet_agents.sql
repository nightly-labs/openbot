CREATE TABLE near_wallet_agents (
  agent_id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX near_wallet_agents_owner ON near_wallet_agents (owner);
