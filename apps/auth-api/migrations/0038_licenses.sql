-- A new table only. The Worker that runs before this deploy does not read it, and it ignores license
-- subscriptions because their lookup key names no server plan.
-- One row for each Stripe subscription of the commercial license. The quantity of the subscription is
-- the number of users that the account pays for. License rows never go in billing_subscriptions, so the
-- server plans, their member limits and their reports do not change.
CREATE TABLE IF NOT EXISTS licenses (
  stripe_subscription_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  users INTEGER NOT NULL CHECK(users >= 1),
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_end INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK(cancel_at_period_end IN (0, 1)),
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS licenses_user ON licenses(user_id, updated_at DESC);
