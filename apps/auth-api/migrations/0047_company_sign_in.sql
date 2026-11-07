-- Company sign-in: a server owner connects the company's OpenID Connect provider, such as Microsoft
-- Entra ID, Okta or Google Workspace. A person whose email is at one of its domains then signs in
-- there, not with an email code. SCIM from the same provider turns off a person who leaves.
-- New tables only: the deployed Worker does not read them.

-- One connection for each server. The client secret is stored encrypted, the SCIM token as a hash.
CREATE TABLE company_sign_in_connections (
  host_id TEXT PRIMARY KEY REFERENCES remote_hosts(host_id) ON DELETE CASCADE,
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret_ciphertext TEXT NOT NULL,
  -- 1: email codes are refused for the domains, and people sign in with the provider.
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  -- The owner who saved the connection. SCIM acts for this account.
  updated_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tested_at INTEGER NOT NULL,
  scim_token_hash TEXT UNIQUE,
  scim_token_created_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- An email domain belongs to one connection at most.
CREATE TABLE company_sign_in_domains (
  domain TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES company_sign_in_connections(host_id) ON DELETE CASCADE
);

CREATE INDEX company_sign_in_domains_host ON company_sign_in_domains(host_id);

-- The account that a person at the provider signs in to. The subject never changes for a person.
CREATE TABLE company_sign_in_identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (issuer, subject)
);

CREATE INDEX company_sign_in_identities_user ON company_sign_in_identities(user_id);

-- The people that the provider manages through SCIM. An inactive person cannot sign in.
CREATE TABLE company_sign_in_users (
  host_id TEXT NOT NULL REFERENCES company_sign_in_connections(host_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (host_id, user_id)
);

CREATE INDEX company_sign_in_users_user ON company_sign_in_users(user_id);

-- A sign-in or a test at the provider in progress. The flow holds the values it was started with,
-- so a change to the connection during the flow does not change it. Only the hash of the state.
CREATE TABLE company_sign_in_flows (
  state_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('sign_in', 'test')),
  host_id TEXT NOT NULL,
  -- The owner who started a test. NULL for a sign-in.
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

-- One-time codes that the app exchanges for a session after a sign-in. Only the hash of a code.
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
