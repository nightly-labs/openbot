ALTER TABLE mobile_auth_sessions ADD COLUMN connect_link_host_id TEXT;

CREATE INDEX mobile_auth_sessions_connect_link_host ON mobile_auth_sessions(user_id, connect_link_host_id);
