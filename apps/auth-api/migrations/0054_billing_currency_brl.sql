PRAGMA defer_foreign_keys = true;

CREATE TABLE hosted_servers_next (
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
  currency TEXT NOT NULL CHECK(currency IN ('eur', 'usd', 'pln', 'brl')),
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
  deletion_scheduled_at INTEGER,
  deletion_subscription_id TEXT,
  lifecycle_token TEXT,
  lifecycle_lease_until INTEGER,
  legacy_member_limits INTEGER NOT NULL DEFAULT 1 CHECK (legacy_member_limits IN (0, 1)),
  start_requested_at INTEGER,
  operator_host TEXT CHECK (operator_host IS NULL OR provider_sandbox_id IS NULL),
  retired_sandbox_id TEXT,
  plan_ended_at INTEGER,
  UNIQUE(owner_user_id, idempotency_key)
);

INSERT INTO hosted_servers_next (
  server_id, owner_user_id, name, provider, provider_sandbox_id, provider_template, size, pending_size, plan,
  billing_interval, currency, checkout_session_id, desired_state, observed_state, observed_error,
  provider_event_at, last_wake_reason, claim_token_hash, claim_expires_at, claim_redeemed_at, auth_session_id,
  last_active_at, lease_until, next_run_at, idempotency_key, created_at, updated_at, deleted_at,
  deletion_scheduled_at, deletion_subscription_id, lifecycle_token, lifecycle_lease_until, legacy_member_limits,
  start_requested_at, operator_host, retired_sandbox_id, plan_ended_at
)
SELECT
  server_id, owner_user_id, name, provider, provider_sandbox_id, provider_template, size, pending_size, plan,
  billing_interval, currency, checkout_session_id, desired_state, observed_state, observed_error,
  provider_event_at, last_wake_reason, claim_token_hash, claim_expires_at, claim_redeemed_at, auth_session_id,
  last_active_at, lease_until, next_run_at, idempotency_key, created_at, updated_at, deleted_at,
  deletion_scheduled_at, deletion_subscription_id, lifecycle_token, lifecycle_lease_until, legacy_member_limits,
  start_requested_at, operator_host, retired_sandbox_id, plan_ended_at
FROM hosted_servers;

DROP TABLE hosted_servers;

ALTER TABLE hosted_servers_next RENAME TO hosted_servers;

CREATE INDEX hosted_servers_owner ON hosted_servers(owner_user_id, created_at);
CREATE INDEX hosted_servers_scheduled_deletion ON hosted_servers(deletion_scheduled_at)
  WHERE deletion_scheduled_at IS NOT NULL;
CREATE UNIQUE INDEX hosted_servers_operator_host ON hosted_servers(operator_host)
  WHERE operator_host IS NOT NULL;

CREATE TABLE billing_sales_checkouts_next (
  session_id TEXT PRIMARY KEY,
  return_token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id TEXT,
  plan TEXT NOT NULL CHECK(plan IN ('starter', 'standard', 'pro')),
  interval TEXT NOT NULL CHECK(interval IN ('month', 'year')),
  currency TEXT NOT NULL CHECK(currency IN ('eur', 'usd', 'pln', 'brl')),
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

INSERT INTO billing_sales_checkouts_next (
  session_id, return_token_hash, user_id, server_id, plan, interval, currency, amount, return_url, created_at,
  expires_at, completed_at, expired_at, returned_at, subscription_id, updated_at
)
SELECT
  session_id, return_token_hash, user_id, server_id, plan, interval, currency, amount, return_url, created_at,
  expires_at, completed_at, expired_at, returned_at, subscription_id, updated_at
FROM billing_sales_checkouts;

DROP TABLE billing_sales_checkouts;

ALTER TABLE billing_sales_checkouts_next RENAME TO billing_sales_checkouts;

CREATE INDEX billing_sales_checkouts_user
  ON billing_sales_checkouts(user_id, created_at);
CREATE INDEX billing_sales_checkouts_open
  ON billing_sales_checkouts(expires_at, completed_at, returned_at);
