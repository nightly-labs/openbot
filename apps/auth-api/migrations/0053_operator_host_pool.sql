ALTER TABLE hosted_servers ADD COLUMN plan_ended_at INTEGER;

CREATE TABLE IF NOT EXISTS operator_hosts (
  host_id TEXT PRIMARY KEY CHECK (
    host_id GLOB 'leaseweb:[0-9]*' AND host_id NOT GLOB 'leaseweb:*[^0-9]*' AND length(host_id) <= 64
  ),
  location TEXT NOT NULL CHECK (location GLOB '[A-Z][A-Z][A-Z]-[0-9][0-9]'),
  product TEXT NOT NULL CHECK (product GLOB 'VPS[0-9][0-9]'),
  added_at INTEGER NOT NULL,
  removed_at INTEGER
);
