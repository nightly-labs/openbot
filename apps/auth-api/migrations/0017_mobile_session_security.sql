ALTER TABLE team_auth_tickets ADD COLUMN mobile_host_id TEXT;
ALTER TABLE team_auth_tickets ADD COLUMN mobile_host_fingerprint TEXT;

UPDATE auth_sessions SET expires_at = 8640000000000000
WHERE revoked_at IS NULL AND expires_at > unixepoch('now') * 1000;
UPDATE remote_sessions SET expires_at = 8640000000000000
WHERE ended_at IS NULL AND expires_at > unixepoch('now') * 1000;

CREATE TRIGGER auth_session_revokes_remote_sessions
AFTER UPDATE OF revoked_at ON auth_sessions
WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
BEGIN
  INSERT INTO remote_auth_events(event_id, payload, created_at, attempts, next_attempt_at)
  SELECT lower(hex(randomblob(16))),
    json_object('type', 'remote-session-ended', 'hostId', host_id, 'sessionId', session_id),
    NEW.revoked_at, 0, NEW.revoked_at
  FROM remote_sessions WHERE user_id = NEW.user_id AND ended_at IS NULL;
  UPDATE remote_sessions SET ended_at = NEW.revoked_at
  WHERE user_id = NEW.user_id AND ended_at IS NULL;
END;
