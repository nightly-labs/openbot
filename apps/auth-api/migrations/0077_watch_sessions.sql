CREATE TABLE IF NOT EXISTS watch_sessions (
  watch_session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_session_hash TEXT NOT NULL REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL CHECK (length(public_key) = 87 AND substr(public_key, 1, 1) = 'B'),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_used_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS watch_sessions_user_active ON watch_sessions(user_id, created_at)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS watch_sessions_auth_session ON watch_sessions(auth_session_hash);
CREATE INDEX IF NOT EXISTS watch_sessions_user_key ON watch_sessions(user_id, public_key)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS watch_sessions_expires_at ON watch_sessions(expires_at);

CREATE TRIGGER IF NOT EXISTS auth_session_revokes_watch_sessions
AFTER UPDATE OF revoked_at ON auth_sessions
WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
BEGIN
  UPDATE watch_sessions SET revoked_at = NEW.revoked_at
  WHERE auth_session_hash = NEW.token_hash AND revoked_at IS NULL;
END;
