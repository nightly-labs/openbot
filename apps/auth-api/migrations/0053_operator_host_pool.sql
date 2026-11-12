-- A nullable column and a new table. The Worker before this deploy reads neither.
--
-- plan_ended_at: when the plan of the server last ended (`desired_state = 'stopped'`). A server on a
-- machine of the operator is deleted 30 days later. `updated_at` changes on each write, so it cannot
-- give that date.
ALTER TABLE hosted_servers ADD COLUMN plan_ended_at INTEGER;

-- The machines that the operator runs for hosted servers: the pool. A machine that no
-- `hosted_servers.operator_host` names is free. `removed_at` is set when the machine leaves the pool.
CREATE TABLE IF NOT EXISTS operator_hosts (
  host_id TEXT PRIMARY KEY CHECK (
    host_id GLOB 'leaseweb:[0-9]*' AND host_id NOT GLOB 'leaseweb:*[^0-9]*' AND length(host_id) <= 64
  ),
  location TEXT NOT NULL CHECK (location GLOB '[A-Z][A-Z][A-Z]-[0-9][0-9]'),
  product TEXT NOT NULL CHECK (product GLOB 'VPS[0-9][0-9]'),
  added_at INTEGER NOT NULL,
  removed_at INTEGER
);
