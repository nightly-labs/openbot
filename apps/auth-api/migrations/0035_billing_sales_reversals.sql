CREATE TABLE billing_sales_facts_next (
  source_key TEXT PRIMARY KEY,
  fact_type TEXT NOT NULL CHECK(
    fact_type IN (
      'checkout_started',
      'checkout_completed',
      'checkout_expired',
      'checkout_returned',
      'payment_failed',
      'payment_succeeded',
      'payment_refunded',
      'refund_failed',
      'payment_disputed',
      'dispute_lost'
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

INSERT INTO billing_sales_facts_next (
  source_key,
  fact_type,
  source_id,
  invoice_id,
  session_id,
  user_id,
  server_id,
  event_timestamp,
  attributes_json,
  delivery_enqueued_at,
  created_at
)
SELECT
  source_key,
  fact_type,
  source_id,
  invoice_id,
  session_id,
  user_id,
  server_id,
  event_timestamp,
  attributes_json,
  delivery_enqueued_at,
  created_at
FROM billing_sales_facts;

DROP TABLE billing_sales_facts;

ALTER TABLE billing_sales_facts_next RENAME TO billing_sales_facts;

CREATE INDEX billing_sales_facts_pending
  ON billing_sales_facts(delivery_enqueued_at, event_timestamp, source_key)
  WHERE delivery_enqueued_at IS NULL;
CREATE INDEX billing_sales_facts_invoice
  ON billing_sales_facts(invoice_id, fact_type, event_timestamp)
  WHERE invoice_id IS NOT NULL;
CREATE INDEX billing_sales_facts_user
  ON billing_sales_facts(user_id, fact_type, event_timestamp)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX billing_sales_paid_invoice
  ON billing_sales_facts(invoice_id)
  WHERE fact_type = 'payment_succeeded' AND invoice_id IS NOT NULL;
