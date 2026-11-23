CREATE TABLE IF NOT EXISTS billing_customers (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  stripe_subscription_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  server_id TEXT,
  plan TEXT NOT NULL,
  interval TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount INTEGER CHECK(amount IS NULL OR amount >= 0),
  status TEXT NOT NULL,
  current_period_end INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK(cancel_at_period_end IN (0, 1)),
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS billing_subscriptions_user ON billing_subscriptions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS billing_subscriptions_server ON billing_subscriptions(server_id, updated_at DESC)
  WHERE server_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
