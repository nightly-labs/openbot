CREATE TABLE mobile_connect_links (
  link_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  desktop_session_id TEXT NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  host_id TEXT NOT NULL REFERENCES remote_hosts(host_id) ON DELETE CASCADE,
  host_fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_used_at INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX mobile_connect_links_user_host ON mobile_connect_links(user_id, host_id);
CREATE INDEX mobile_connect_links_desktop_session ON mobile_connect_links(desktop_session_id);
CREATE INDEX mobile_connect_links_host ON mobile_connect_links(host_id);
