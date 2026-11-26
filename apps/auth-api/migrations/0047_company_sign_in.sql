CREATE TABLE company_sign_in_connections (
  host_id TEXT PRIMARY KEY REFERENCES remote_hosts(host_id) ON DELETE CASCADE,
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret_ciphertext TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tested_at INTEGER NOT NULL,
  scim_token_hash TEXT UNIQUE,
  scim_token_created_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE company_sign_in_domains (
  domain TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES company_sign_in_connections(host_id) ON DELETE CASCADE
);

CREATE INDEX company_sign_in_domains_host ON company_sign_in_domains(host_id);

CREATE TABLE company_sign_in_identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (issuer, subject)
);

CREATE INDEX company_sign_in_identities_user ON company_sign_in_identities(user_id);

CREATE TABLE company_sign_in_users (
  host_id TEXT NOT NULL REFERENCES company_sign_in_connections(host_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (host_id, user_id)
);

CREATE INDEX company_sign_in_users_user ON company_sign_in_users(user_id);

CREATE TABLE company_sign_in_flows (
  state_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('sign_in', 'test')),
  host_id TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret_ciphertext TEXT NOT NULL,
  domains_json TEXT NOT NULL,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_to TEXT NOT NULL,
  client_state TEXT NOT NULL,
  client_challenge TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX company_sign_in_flows_expires_at ON company_sign_in_flows(expires_at);

CREATE TABLE company_sign_in_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_challenge TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  session_id TEXT
);

CREATE INDEX company_sign_in_codes_expires_at ON company_sign_in_codes(expires_at);
