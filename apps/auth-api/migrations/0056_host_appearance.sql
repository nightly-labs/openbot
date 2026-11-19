-- The look that the owner or an admin chose for a server with no logo (`host-appearance-v1`). The
-- host is the source of truth and copies its choice here, so a client shows it before it connects.
-- Two nullable columns. The Worker before this deploy reads neither, and its inserts name their columns.
--
-- appearance_shape: a shape ID from SERVER_APPEARANCE_SHAPES. NULL: the automatic look.
-- appearance_color: a lowercase `#rrggbb`. NULL: the automatic colour of the server.
ALTER TABLE remote_hosts ADD COLUMN appearance_shape TEXT;
ALTER TABLE remote_hosts ADD COLUMN appearance_color TEXT;
