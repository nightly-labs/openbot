-- Durable checkout and payment facts. The Worker that runs before this deploy does not read these
-- tables. Fact columns are immutable; delivery_enqueued_at is the only delivery bookkeeping field.
CREATE TABLE IF NOT EXISTS billing_sales_checkouts (
  session_id TEXT PRIMARY KEY,
  return_token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id TEXT,
  plan TEXT NOT NULL CHECK(plan IN ('starter', 'standard', 'pro')),
  interval TEXT NOT NULL CHECK(interval IN ('month', 'year')),
  currency TEXT NOT NULL CHECK(currency IN ('eur', 'usd', 'pln')),
  amount INTEGER NOT NULL CHECK(amount >= 0),
  return_url TEXT NOT NULL CHECK(return_url LIKE '/app%' OR return_url LIKE '/billing/return%'),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER,
  expired_at INTEGER,
  returned_at INTEGER,
  subscription_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS billing_sales_checkouts_user
  ON billing_sales_checkouts(user_id, created_at);
CREATE INDEX IF NOT EXISTS billing_sales_checkouts_open
  ON billing_sales_checkouts(expires_at, completed_at, returned_at);

CREATE TABLE IF NOT EXISTS billing_sales_facts (
  source_key TEXT PRIMARY KEY,
  fact_type TEXT NOT NULL CHECK(
    fact_type IN (
      'checkout_started',
      'checkout_completed',
      'checkout_expired',
      'checkout_returned',
      'payment_failed',
      'payment_succeeded'
    )
  ),
  source_id TEXT NOT NULL,
  invoice_id TEXT,
  session_id TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  server_id TEXT,
  event_timestamp INTEGER NOT NULL,
  attributes_json TEXT NOT NULL,
  delivery_enqueued_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS billing_sales_facts_pending
  ON billing_sales_facts(delivery_enqueued_at, event_timestamp, source_key)
  WHERE delivery_enqueued_at IS NULL;
CREATE INDEX IF NOT EXISTS billing_sales_facts_invoice
  ON billing_sales_facts(invoice_id, fact_type, event_timestamp)
  WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS billing_sales_facts_user
  ON billing_sales_facts(user_id, fact_type, event_timestamp)
  WHERE user_id IS NOT NULL;

-- The paid invoice id is the idempotency boundary. Stripe can deliver the same invoice with more
-- than one event id, so this index is required in addition to source_key.
CREATE UNIQUE INDEX IF NOT EXISTS billing_sales_paid_invoice
  ON billing_sales_facts(invoice_id)
  WHERE fact_type = 'payment_succeeded' AND invoice_id IS NOT NULL;
