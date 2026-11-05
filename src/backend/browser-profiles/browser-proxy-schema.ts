// Shared by migration v56 and the separate new-database schema. IF NOT EXISTS, because this text is
// both the migration and the tail of the latest schema.
//
// A browser proxy is a saved proxy server that named browser profiles can use, or the computer of
// one member (`kind = 'computer'`), which sends the traffic through the connection of the OpenBot
// desktop app of that member while the member shares it. An address proxy has a scheme, a host and a
// port; the host is its label. A computer proxy has only the membership id of the member
// (`member_id`), and each member has at most one. The password is encrypted with the OS secret storage (`safeStorage`) before
// it is written; it is never read back to the renderer or a remote member. A profile without a row in
// `browser_profile_proxies` uses the proxy settings of the computer that runs OpenBot. A delete of a
// proxy or of a profile deletes its rows here, so the profiles of a deleted proxy go back to those
// settings. Configuration, written directly.
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
