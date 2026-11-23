CREATE TABLE hosted_servers (
  server_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'boat' CHECK(provider IN ('boat')),
  provider_sandbox_id TEXT UNIQUE,
  provider_template TEXT,
  size TEXT NOT NULL CHECK(size IN ('small', 'default', 'large')),
  pending_size TEXT CHECK(pending_size IS NULL OR pending_size IN ('small', 'default', 'large')),
  plan TEXT NOT NULL CHECK(plan IN ('starter', 'standard', 'pro')),
  billing_interval TEXT NOT NULL CHECK(billing_interval IN ('month', 'year')),
  currency TEXT NOT NULL CHECK(currency IN ('eur', 'usd', 'pln')),
  checkout_session_id TEXT,
  desired_state TEXT NOT NULL CHECK(desired_state IN ('running', 'idle', 'stopped', 'deleted')),
  observed_state TEXT NOT NULL CHECK(
    observed_state IN (
      'awaiting_payment', 'creating', 'starting', 'running', 'stopping', 'stopped', 'waking', 'error', 'deleted'
    )
  ),
  observed_error TEXT CHECK(
    observed_error IS NULL OR
    observed_error IN ('provider_error', 'provider_billing', 'provider_limit', 'start_failed', 'plan_ended')
  ),
  provider_event_at INTEGER,
  last_wake_reason TEXT CHECK(last_wake_reason IS NULL OR last_wake_reason IN ('create', 'message', 'restart', 'schedule')),
  claim_token_hash TEXT UNIQUE,
  claim_expires_at INTEGER,
  claim_redeemed_at INTEGER,
  auth_session_id TEXT,
  last_active_at INTEGER,
  lease_until INTEGER,
  next_run_at INTEGER,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE(owner_user_id, idempotency_key)
);

CREATE INDEX hosted_servers_owner ON hosted_servers(owner_user_id, created_at);

CREATE TABLE hosting_webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);

CREATE INDEX hosting_webhook_deliveries_received ON hosting_webhook_deliveries(received_at);
