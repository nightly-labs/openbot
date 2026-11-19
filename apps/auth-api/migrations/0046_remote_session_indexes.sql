CREATE INDEX remote_sessions_active_host_user
  ON remote_sessions(host_id, user_id)
  WHERE ended_at IS NULL;
CREATE INDEX remote_sessions_membership_id ON remote_sessions(membership_id);
