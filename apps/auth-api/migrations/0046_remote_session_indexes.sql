-- The expired-session sweep and the invite-join close filter on one host and user's active sessions.
-- The partial unique indexes from 0018 also filter on `auth_session_hash`, so SQLite cannot use them
-- there and reads every session the host ever had, ended ones too.
CREATE INDEX remote_sessions_active_host_user
  ON remote_sessions(host_id, user_id)
  WHERE ended_at IS NULL;
-- `ON DELETE CASCADE` from remote_memberships looks sessions up by membership. Without this index,
-- each deleted membership scans the whole table.
CREATE INDEX remote_sessions_membership_id ON remote_sessions(membership_id);
