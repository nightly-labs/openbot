CREATE TABLE agent_templates (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_agent_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  avatar_key TEXT,
  card_key TEXT,
  unpublished_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(owner_user_id, source_agent_id)
);

CREATE INDEX agent_templates_owner ON agent_templates(owner_user_id, updated_at DESC);
