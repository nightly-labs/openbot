-- The latest product analytics answer of the account, from any device: 1 = yes, 0 = no, NULL = the
-- user never answered. A regional default is not an answer and is never stored. The Worker that runs
-- before this deploy does not read the columns, and its inserts get NULL.
ALTER TABLE users ADD COLUMN analytics_enabled INTEGER CHECK(analytics_enabled IN (0, 1));
-- When the user gave that answer (Unix ms). A device that sends an answer later, such as after it was
-- offline, cannot replace a newer answer from another device.
ALTER TABLE users ADD COLUMN analytics_answered_at INTEGER;
