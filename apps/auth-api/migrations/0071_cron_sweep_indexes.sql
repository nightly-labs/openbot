CREATE INDEX IF NOT EXISTS site_operation_receipts_created_at ON site_operation_receipts(created_at);

CREATE INDEX IF NOT EXISTS site_creation_events_created_at ON site_creation_events(created_at);

CREATE INDEX IF NOT EXISTS hosted_sites_route_unsynced
  ON hosted_sites(updated_at, id)
  WHERE route_synced_at IS NULL;

CREATE INDEX IF NOT EXISTS billing_analytics_events_sending
  ON billing_analytics_events(claimed_at)
  WHERE status = 'sending';
