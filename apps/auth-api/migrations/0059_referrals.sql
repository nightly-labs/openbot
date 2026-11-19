-- Invite friends. A friend who signs up with the invite link of an account gets 10% off each payment. The
-- account gets 10% of each paid invoice of the friend as Stripe customer credit, which Stripe takes off
-- its next invoice. Only new tables: the Worker from before this deploy does not read them.

-- The invite code of an account. It is made when the account first opens Invite friends.
CREATE TABLE IF NOT EXISTS referral_codes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- One row for each account that signed up with an invite link, or typed an invite code soon after sign-up.
-- An account has at most one referrer, and only a new account gets one.
-- `blocked_at` is set when the friend paid with a card that the referrer also used: the friend loses the
-- discount, the referrer gets no more credit from this friend, and the friend leaves the referrer's list.
CREATE TABLE IF NOT EXISTS referrals (
  referred_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  referrer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  blocked_at INTEGER,
  CHECK (referred_user_id <> referrer_user_id)
);

CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals(referrer_user_id, created_at DESC);

-- One row for each paid invoice of a friend. The row is written before the Stripe credit, so a retry of
-- the webhook sends the credit again with the same idempotency key and never twice.
-- `amount` is the credit in `currency`, the currency of the referrer's Stripe customer.
-- `released_at` is NULL until the friend pays a second time. `queued_at` is set when the released credit of
-- the referrer in `currency` reaches the minimum; from then on each webhook sends the row until Stripe
-- accepts it, even when a refund takes the total below the minimum again.
-- `balance_transaction_id` is NULL until Stripe accepted the credit. It is '' when a refund took all of a
-- waiting credit back and nothing went to Stripe.
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

-- One row for each refund or lost dispute that took credit back. Written before the Stripe change, like
-- `referral_credits`. `balance_transaction_id` is '' when nothing went to Stripe: the credit still waited,
-- or nothing was left to take back.
CREATE TABLE IF NOT EXISTS referral_reversals (
  reversal_id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES referral_credits(invoice_id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  balance_transaction_id TEXT,
  created_at INTEGER NOT NULL
);
