-- The ID of the Signal machine that the host connects to, from `REMOTE_SIGNAL_HOMES`. NULL = the host
-- has no home and uses the entry Signal (`REMOTE_SIGNAL_URL`). The Worker that runs before this
-- deploy does not read the column.
ALTER TABLE remote_hosts ADD COLUMN signal_home TEXT;
-- The Signal webhook URLs that must still get the event, as a JSON array. NULL = every configured URL.
-- The Worker that runs before this deploy does not read the column, and its inserts get NULL.
ALTER TABLE remote_auth_events ADD COLUMN pending_targets TEXT;
