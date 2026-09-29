-- New tables only. The Worker that runs before this deploy does not read them.
-- The owner has no ON DELETE CASCADE: a removed row would leave a paid sandbox with no record.
CREATE TABLE hosted_servers (
  server_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'boat' CHECK(provider IN ('boat')),
  provider_sandbox_id TEXT UNIQUE,
  -- The template of the first create. A retry sends the same request, so boat returns the sandbox of a
  -- create whose answer was lost.
  provider_template TEXT,
  -- The machine of the sandbox.
  size TEXT NOT NULL CHECK(size IN ('small', 'default', 'large')),
  -- The machine of a new plan, until boat resumes the sandbox on it. boat changes the size only on a resume.
  pending_size TEXT CHECK(pending_size IS NULL OR pending_size IN ('small', 'default', 'large')),
  -- The plan of the server. The Worker copies a change in the Customer Portal to these three columns,
  -- but the Stripe subscription (billing_subscriptions) decides whether the server has a plan.
  plan TEXT NOT NULL CHECK(plan IN ('starter', 'standard', 'pro')),
  billing_interval TEXT NOT NULL CHECK(billing_interval IN ('month', 'year')),
  currency TEXT NOT NULL CHECK(currency IN ('eur', 'usd', 'pln')),
  -- The newest Checkout Session of a server that waits for its first payment.
  checkout_session_id TEXT,
  -- 'idle': no use for 15 minutes. The sandbox is archived and kept, and it starts again on the next use.
  -- 'stopped': the plan ended. The sandbox is archived and kept, and it starts again on renewal.
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
  -- The creation time of the newest provider event applied. Older events that arrive late are ignored.
  provider_event_at INTEGER,
  last_wake_reason TEXT CHECK(last_wake_reason IS NULL OR last_wake_reason IN ('create', 'message', 'restart', 'schedule')),
  claim_token_hash TEXT UNIQUE,
  claim_expires_at INTEGER,
  claim_redeemed_at INTEGER,
  auth_session_id TEXT,
  -- The last activity report of the server, or its last start.
  last_active_at INTEGER,
  -- When boat stops the sandbox by itself. Each create and resume sets it, and activity extends it.
  lease_until INTEGER,
  -- The next routine run that the server reported. The cron starts an idle server before it.
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
