CREATE TABLE credit_codes (
  code_id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE CHECK (length(code_hash) = 64),
  credits_tenths INTEGER NOT NULL CHECK (credits_tenths > 0),
  max_redemptions INTEGER NOT NULL DEFAULT 1 CHECK (max_redemptions > 0),
  redemptions INTEGER NOT NULL DEFAULT 0 CHECK (redemptions >= 0 AND redemptions <= max_redemptions),
  grant_days INTEGER NOT NULL DEFAULT 365 CHECK (grant_days BETWEEN 1 AND 3650),
  expires_at INTEGER,
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  campaign TEXT NOT NULL DEFAULT '' CHECK (length(campaign) <= 40),
  created_at INTEGER NOT NULL,
  disabled_at INTEGER
);

CREATE INDEX credit_codes_created ON credit_codes(created_at);

CREATE TABLE credit_code_redemptions (
  code_id TEXT NOT NULL REFERENCES credit_codes(code_id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id TEXT,
  grant_id TEXT NOT NULL UNIQUE,
  redeemed_at INTEGER NOT NULL,
  PRIMARY KEY (code_id, user_id)
);

CREATE INDEX credit_code_redemptions_user ON credit_code_redemptions(user_id, redeemed_at);

CREATE TABLE credit_code_limits (
  key_hash TEXT NOT NULL CHECK (length(key_hash) = 64),
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (key_hash, window_start)
);

CREATE INDEX credit_code_limits_window ON credit_code_limits(window_start);
