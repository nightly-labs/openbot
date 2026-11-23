CREATE TABLE IF NOT EXISTS hosted_server_archives (
  object_key TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  region TEXT NOT NULL,
  bucket TEXT NOT NULL,
  version_id TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  wrapped_key TEXT,
  plan_ended_at INTEGER NOT NULL,
  delete_after INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  restored_at INTEGER,
  deleted_at INTEGER,
  CHECK ((deleted_at IS NULL) = (wrapped_key IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS hosted_server_archives_server ON hosted_server_archives(server_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hosted_server_archives_due ON hosted_server_archives(delete_after) WHERE deleted_at IS NULL;
