-- When the Worker asked boat for the current start of the sandbox: a create, or a resume after a stop.
-- NULL = no start waits. The Worker clears it when boat reports the sandbox as usable, and sends the
-- time of the start to analytics. The Worker that runs before this deploy does not read the column.
ALTER TABLE hosted_servers ADD COLUMN start_requested_at INTEGER;
