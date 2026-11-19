CREATE TABLE IF NOT EXISTS referral_codes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS referrals (
  referred_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  referrer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  blocked_at INTEGER,
  CHECK (referred_user_id <> referrer_user_id)
);

CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals(referrer_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS referral_credits (
  invoice_id TEXT PRIMARY KEY,
  referrer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_currency TEXT NOT NULL,
  source_amount INTEGER NOT NULL CHECK (source_amount >= 0),
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  reversed_amount INTEGER NOT NULL DEFAULT 0 CHECK (reversed_amount >= 0 AND reversed_amount <= amount),
  balance_transaction_id TEXT,
  released_at INTEGER,
  queued_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS referral_credits_referrer ON referral_credits(referrer_user_id, created_at);
CREATE INDEX IF NOT EXISTS referral_credits_referred ON referral_credits(referred_user_id, created_at);

CREATE TABLE IF NOT EXISTS referral_reversals (
  reversal_id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES referral_credits(invoice_id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  balance_transaction_id TEXT,
  created_at INTEGER NOT NULL
);
