ALTER TABLE remote_auth_events ADD COLUMN attempted_at INTEGER;

CREATE INDEX remote_auth_events_attempted
  ON remote_auth_events(attempted_at, event_id);
