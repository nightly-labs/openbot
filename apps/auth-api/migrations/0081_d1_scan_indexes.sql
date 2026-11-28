CREATE INDEX IF NOT EXISTS site_deployments_site_status ON site_deployments(site_id, status, upload_expires_at);

CREATE INDEX IF NOT EXISTS account_active_days_account ON account_active_days(account_id);

CREATE INDEX IF NOT EXISTS billing_webhook_events_received_at ON billing_webhook_events(received_at);
