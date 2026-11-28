CREATE TABLE auth_session_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('session', 'user')),
  subject_id TEXT NOT NULL,
  changed_at INTEGER NOT NULL
);

CREATE INDEX auth_session_changes_changed_at ON auth_session_changes(changed_at);

CREATE TRIGGER auth_session_changes_session_update
AFTER UPDATE OF revoked_at, expires_at, user_id, token_hash ON auth_sessions
WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
  OR NEW.expires_at < OLD.expires_at
  OR NEW.user_id IS NOT OLD.user_id
  OR NEW.token_hash IS NOT OLD.token_hash
BEGIN
  INSERT INTO auth_session_changes(kind, subject_id, changed_at)
  VALUES ('session', NEW.id, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
END;

CREATE TRIGGER auth_session_changes_session_delete
AFTER DELETE ON auth_sessions
WHEN OLD.revoked_at IS NULL AND OLD.expires_at > CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
BEGIN
  INSERT INTO auth_session_changes(kind, subject_id, changed_at)
  VALUES ('session', OLD.id, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
END;

CREATE TRIGGER auth_session_changes_mobile_insert
AFTER INSERT ON mobile_auth_sessions
BEGIN
  INSERT INTO auth_session_changes(kind, subject_id, changed_at)
  VALUES ('session', NEW.session_id, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
END;

CREATE TRIGGER auth_session_changes_mobile_delete
AFTER DELETE ON mobile_auth_sessions
WHEN EXISTS (
  SELECT 1 FROM auth_sessions
  WHERE id = OLD.session_id
    AND revoked_at IS NULL
    AND expires_at > CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
)
BEGIN
  INSERT INTO auth_session_changes(kind, subject_id, changed_at)
  VALUES ('session', OLD.session_id, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
END;

CREATE TRIGGER auth_session_changes_user_update
AFTER UPDATE OF email, name, avatar_url, analytics_enabled, chat_color ON users
WHEN NEW.email IS NOT OLD.email
  OR NEW.name IS NOT OLD.name
  OR NEW.avatar_url IS NOT OLD.avatar_url
  OR NEW.analytics_enabled IS NOT OLD.analytics_enabled
  OR NEW.chat_color IS NOT OLD.chat_color
BEGIN
  INSERT INTO auth_session_changes(kind, subject_id, changed_at)
  VALUES ('user', NEW.id, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
END;

CREATE TRIGGER auth_session_changes_user_delete
AFTER DELETE ON users
BEGIN
  INSERT INTO auth_session_changes(kind, subject_id, changed_at)
  VALUES ('user', OLD.id, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
END;
