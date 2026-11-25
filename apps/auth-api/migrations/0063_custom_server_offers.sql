CREATE TABLE IF NOT EXISTS custom_server_offers (
  host_id TEXT PRIMARY KEY,
  plan_name TEXT NOT NULL CHECK(length(trim(plan_name)) BETWEEN 1 AND 60),
  amount INTEGER NOT NULL CHECK(typeof(amount) = 'integer' AND amount BETWEEN 100 AND 10000000),
  currency TEXT NOT NULL CHECK(currency IN ('eur', 'usd', 'pln', 'brl')),
  billing_interval TEXT NOT NULL CHECK(billing_interval IN ('month', 'year')),
  vcpu INTEGER NOT NULL CHECK(typeof(vcpu) = 'integer' AND vcpu BETWEEN 1 AND 100000),
  memory_gb INTEGER NOT NULL CHECK(typeof(memory_gb) = 'integer' AND memory_gb BETWEEN 1 AND 100000),
  storage_gb INTEGER NOT NULL CHECK(typeof(storage_gb) = 'integer' AND storage_gb BETWEEN 1 AND 100000),
  personalized_support INTEGER NOT NULL CHECK(personalized_support IN (0, 1)),
  checkout_session_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS custom_server_offers_subscription
  ON custom_server_offers(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
