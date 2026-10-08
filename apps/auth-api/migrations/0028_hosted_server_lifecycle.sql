-- Nullable additions preserve the deployed Worker and all existing servers.
ALTER TABLE hosted_servers ADD COLUMN deletion_scheduled_at INTEGER;
ALTER TABLE hosted_servers ADD COLUMN deletion_subscription_id TEXT;
ALTER TABLE hosted_servers ADD COLUMN lifecycle_token TEXT;
ALTER TABLE hosted_servers ADD COLUMN lifecycle_lease_until INTEGER;
CREATE INDEX hosted_servers_scheduled_deletion ON hosted_servers(deletion_scheduled_at)
  WHERE deletion_scheduled_at IS NOT NULL;
