CREATE TABLE telegram_chat_routes (
  bot_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  host_id TEXT NOT NULL REFERENCES remote_hosts(host_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (bot_id, chat_id)
);

CREATE INDEX telegram_chat_routes_host ON telegram_chat_routes(host_id);

CREATE TABLE telegram_link_codes (
  code_hash TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  host_id TEXT NOT NULL REFERENCES remote_hosts(host_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  chat_id TEXT,
  linked_at INTEGER
);

CREATE INDEX telegram_link_codes_host ON telegram_link_codes(host_id, expires_at);
