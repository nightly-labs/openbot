-- New tables only. The Worker that runs before this deploy does not read them.
-- Which OpenBot host answers each Telegram chat of the OpenBot bot. Signal routes a chat's updates to
-- that host. No chat title, message or token is kept here: Signal has the bot token.
CREATE TABLE telegram_chat_routes (
  -- The bot in the chat. The production and development bots can share a chat.
  bot_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  host_id TEXT NOT NULL REFERENCES remote_hosts(host_id) ON DELETE CASCADE,
  -- The account that linked the chat. Only this account can move it to another host.
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (bot_id, chat_id)
);

CREATE INDEX telegram_chat_routes_host ON telegram_chat_routes(host_id);

-- The one-use codes that link a chat to a host. Only the SHA-256 of a code is kept. A used code keeps
-- the chat that it linked, so a repeated `/start <code>` from that chat gets the same answer.
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
