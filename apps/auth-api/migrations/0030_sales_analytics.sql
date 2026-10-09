-- New tables only. The Worker that runs before this deploy does not read them.
-- Keep every source key forever. A paid invoice must never be sent twice after a retry.
CREATE TABLE IF NOT EXISTS billing_analytics_events (
  source_key TEXT PRIMARY KEY,
  profile_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL CHECK(event_name IN ('billing_action', 'revenue', 'billing_snapshot')),
  properties_json TEXT NOT NULL,
  event_timestamp INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'sending', 'sent', 'uncertain', 'rejected')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER,
  claim_token TEXT,
  last_status INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS billing_analytics_events_ready
  ON billing_analytics_events(status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'rejected');

CREATE INDEX IF NOT EXISTS billing_analytics_events_profile
  ON billing_analytics_events(profile_id, event_timestamp)
  WHERE profile_id IS NOT NULL;

-- A deleted account must not turn an undelivered account event into an anonymous revenue event.
-- The source key remains in the ledger for deduplication; the foreign key clears the profile id.
CREATE TRIGGER IF NOT EXISTS billing_analytics_events_user_deleted
BEFORE DELETE ON users
BEGIN
  UPDATE billing_analytics_events
     SET status = 'rejected', next_attempt_at = 0, claimed_at = NULL, claim_token = NULL,
         last_error = 'profile_deleted', updated_at = strftime('%s', 'now') * 1000
   WHERE profile_id = OLD.id AND status IN ('pending', 'sending', 'uncertain', 'rejected');
END;

-- Resolve each requested UTC day once. source_day identifies the prior available ECB quote.
-- Existing resolutions are immutable and contain no credentials or payment identifiers.
CREATE TABLE IF NOT EXISTS billing_fx_rates (
  day TEXT NOT NULL,
  currency TEXT NOT NULL,
  source_day TEXT,
  usd_rate REAL NOT NULL CHECK(usd_rate > 0),
  PRIMARY KEY (day, currency)
);
