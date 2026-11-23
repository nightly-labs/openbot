CREATE TABLE credit_purchases (
  checkout_session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id TEXT,
  credits INTEGER NOT NULL CHECK (credits > 0),
  currency TEXT NOT NULL,
  amount INTEGER CHECK (amount IS NULL OR amount >= 0),
  payment_intent_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'expired')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX credit_purchases_user ON credit_purchases(user_id, created_at);
CREATE UNIQUE INDEX credit_purchases_payment_intent
  ON credit_purchases(payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;

CREATE TABLE credit_ledger (
  entry_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  server_id TEXT,
  amount_tenths INTEGER NOT NULL CHECK (amount_tenths <> 0),
  kind TEXT NOT NULL CHECK (kind IN ('purchase', 'transfer', 'reversal', 'spend', 'grant', 'expiry')),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reference TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK ((user_id IS NULL) <> (server_id IS NULL))
);

CREATE INDEX credit_ledger_user ON credit_ledger(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX credit_ledger_server ON credit_ledger(server_id) WHERE server_id IS NOT NULL;

CREATE TABLE credit_holds (
  job_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  server_id TEXT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  model_id TEXT NOT NULL,
  credits_tenths INTEGER NOT NULL CHECK (credits_tenths > 0),
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'charged', 'released')),
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('completed', 'failed', 'canceled', 'refused', 'abandoned', 'expired')),
  charged_tenths INTEGER CHECK (charged_tenths IS NULL OR (charged_tenths >= 0 AND charged_tenths <= credits_tenths)),
  provider_job_id TEXT,
  created_at INTEGER NOT NULL,
  check_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  settled_at INTEGER,
  CHECK ((user_id IS NULL) <> (server_id IS NULL)),
  CHECK ((status = 'held') = (outcome IS NULL)),
  CHECK ((status = 'charged') = (charged_tenths IS NOT NULL))
);

CREATE INDEX credit_holds_user ON credit_holds(user_id) WHERE status = 'held' AND user_id IS NOT NULL;
CREATE INDEX credit_holds_server ON credit_holds(server_id) WHERE status = 'held' AND server_id IS NOT NULL;
CREATE INDEX credit_holds_due ON credit_holds(check_at) WHERE status = 'held';
CREATE UNIQUE INDEX credit_holds_provider_job ON credit_holds(provider_job_id) WHERE provider_job_id IS NOT NULL;

CREATE TABLE credit_grants (
  grant_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  server_id TEXT,
  credits_tenths INTEGER NOT NULL CHECK (credits_tenths > 0),
  remaining_tenths INTEGER NOT NULL CHECK (remaining_tenths >= 0 AND remaining_tenths <= credits_tenths),
  source TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > starts_at),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired')),
  created_at INTEGER NOT NULL,
  CHECK ((user_id IS NULL) <> (server_id IS NULL))
);

CREATE INDEX credit_grants_user ON credit_grants(user_id, expires_at) WHERE status = 'active' AND user_id IS NOT NULL;
CREATE INDEX credit_grants_server ON credit_grants(server_id, expires_at) WHERE status = 'active' AND server_id IS NOT NULL;
CREATE INDEX credit_grants_due ON credit_grants(expires_at) WHERE status = 'active';
CREATE INDEX credit_grants_source ON credit_grants(source, expires_at);
