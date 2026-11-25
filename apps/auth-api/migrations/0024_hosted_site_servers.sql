ALTER TABLE hosted_sites ADD COLUMN server_id TEXT;

CREATE INDEX hosted_sites_server_status ON hosted_sites(server_id, status, expires_at);
