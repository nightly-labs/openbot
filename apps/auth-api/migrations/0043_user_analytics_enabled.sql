-- The latest product analytics answer of the account, from any device: 1 = yes, 0 = no, NULL = the
-- user never answered. A regional default is not an answer and is never stored. The Worker that runs
-- before this deploy does not read the column, and its inserts get NULL.
ALTER TABLE users ADD COLUMN analytics_enabled INTEGER CHECK(analytics_enabled IN (0, 1));
