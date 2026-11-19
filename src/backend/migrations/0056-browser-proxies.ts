import type { OpenBotMigration } from "./migration";

export const BROWSER_PROXY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS browser_proxies (
    proxy_id TEXT NOT NULL PRIMARY KEY CHECK(length(proxy_id) = 32),
    kind TEXT NOT NULL DEFAULT 'address' CHECK(kind IN ('address', 'computer')),
    scheme TEXT CHECK(scheme IN ('socks5', 'http', 'https')),
    host TEXT CHECK(length(host) BETWEEN 1 AND 255),
    port INTEGER CHECK(port BETWEEN 1 AND 65535),
    username TEXT,
    password BLOB,
    member_id TEXT CHECK(length(member_id) BETWEEN 1 AND 255),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK(password IS NULL OR username IS NOT NULL),
    CHECK(
      (kind = 'address' AND scheme IS NOT NULL AND host IS NOT NULL AND port IS NOT NULL AND member_id IS NULL)
      OR (kind = 'computer' AND member_id IS NOT NULL AND scheme IS NULL AND host IS NULL AND port IS NULL
        AND username IS NULL AND password IS NULL)
    )
  );
  CREATE UNIQUE INDEX IF NOT EXISTS browser_proxies_computer ON browser_proxies(member_id) WHERE kind = 'computer';
  CREATE TABLE IF NOT EXISTS browser_profile_proxies (
    profile_id TEXT NOT NULL PRIMARY KEY REFERENCES browser_profiles(profile_id) ON DELETE CASCADE,
    proxy_id TEXT NOT NULL REFERENCES browser_proxies(proxy_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS browser_profile_proxies_proxy ON browser_profile_proxies(proxy_id);
`;

export const migration: OpenBotMigration = {
  version: 56,
  name: "browser-proxies",
  up: (db) => db.exec(BROWSER_PROXY_SCHEMA_SQL),
};
