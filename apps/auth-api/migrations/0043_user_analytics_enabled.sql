ALTER TABLE users ADD COLUMN analytics_enabled INTEGER CHECK(analytics_enabled IN (0, 1));
ALTER TABLE users ADD COLUMN analytics_answered_at INTEGER;
