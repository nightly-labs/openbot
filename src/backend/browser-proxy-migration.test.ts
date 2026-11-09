// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

// Failure modes: the upgrade changes or loses a row of any table; a failed upgrade leaves a table or
// its marker; a newer or incomplete history is accepted; a proxy has a bad id, scheme, port or a
// password without a user name; a profile points at no proxy, or at a proxy of no profile; a deleted
// proxy or profile leaves its assignment behind. These fixtures cover each.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const PROFILE = "a".repeat(32);
const PROXY = "b".repeat(32);
const PROXY_TABLES = { browser_profile_proxies: [], browser_proxies: [] };
// Migrations 58 and 59 run after 56 and add these empty tables.
const LATER_TABLES = { agent_usage_skill_loads: [], projection_messaging_pings: [] };

function databaseAt(version: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  migrateUpTo(db, version);
  return db;
}

function migrateUpTo(db: DatabaseSync, version: number): void {
  db.exec(`CREATE TEMP TRIGGER stop_at_version BEFORE INSERT ON schema_migrations WHEN new.version > ${version}
    BEGIN SELECT RAISE(ABORT, 'fixture stop'); END;`);
  expect(() => migrateOpenBotDatabase(db)).toThrow(`migration to version ${version + 1} failed`);
  db.exec("DROP TRIGGER stop_at_version");
}

/** A memory, and from schema 45 on a named browser profile: the rows that migration 56 must keep. */
function seed(db: DatabaseSync, version: number): void {
  db.prepare(`INSERT INTO projection_agent_memories
    (memory_id, agent_id, text, normalized_text, origin, source_turn_id, created_at, updated_at, last_event_sequence)
    VALUES ('memory-1', 'chief', 'Use the client VPN 界"\\', 'use the client vpn 界"\\', 'manual', NULL,
      '2026-01-01', '2026-01-01', 2)`).run();
  if (version >= 45)
    db.prepare(`INSERT INTO browser_profiles (profile_id, name, hue, created_at, updated_at)
      VALUES (?, 'Client A 界', 215, '2026-01-02', '2026-01-02')`).run(PROFILE);
}

/** Every row of every table, by table name. */
function contents(db: DatabaseSync): Record<string, unknown[]> {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
       AND name <> 'schema_migrations' AND name NOT LIKE 'agent_memory_search%' ORDER BY name`,
    )
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}"`).all()]));
}

function proxyTables(db: DatabaseSync) {
  return db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%prox%' ORDER BY name").all();
}

function expectHealthy(db: DatabaseSync): void {
  expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 59 });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
}

interface ProxyFixture {
  proxy_id: string;
  scheme: string;
  host: string;
  port: number;
  username: string | null;
  password: Uint8Array | null;
}

function insertProxy(db: DatabaseSync, values: Partial<ProxyFixture> = {}): void {
  const row: ProxyFixture = {
    proxy_id: PROXY,
    scheme: "http",
    host: "proxy.example.net",
    port: 8080,
    username: null,
    password: null,
    ...values,
  };
  db.prepare(`INSERT INTO browser_proxies (proxy_id, scheme, host, port, username, password, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '2026-01-03', '2026-01-03')`).run(
    row.proxy_id,
    row.scheme,
    row.host,
    row.port,
    row.username,
    row.password,
  );
}

describe("browser proxy migration", () => {
  it.each(Array.from({ length: 48 }, (_, index) => index + 8))(
    "preserves every row from released schema %i",
    (version) => {
      const db = databaseAt(version);
      seed(db, version);
      // The earlier migrations run first; the rows after them are what v56 must keep.
      if (version < 55) migrateUpTo(db, 55);
      const before = contents(db);
      migrateOpenBotDatabase(db);
      expect(contents(db)).toEqual({ ...before, ...PROXY_TABLES, ...LATER_TABLES });
      expectHealthy(db);
    },
  );

  it("rolls back the tables and the marker after a late failure, then retries", () => {
    const db = databaseAt(55);
    seed(db, 55);
    const before = contents(db);
    db.exec(`CREATE TEMP TRIGGER fail_marker BEFORE INSERT ON schema_migrations WHEN new.version=56
      BEGIN SELECT RAISE(ABORT, 'late failure'); END;`);
    expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 56 failed");
    expect(contents(db)).toEqual(before);
    expect(proxyTables(db)).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=56").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("DROP TRIGGER fail_marker");
    migrateOpenBotDatabase(db);
    expect(contents(db)).toEqual({ ...before, ...PROXY_TABLES, ...LATER_TABLES });
    expectHealthy(db);
  });

  it("rejects newer and incomplete migration histories before it creates the tables", () => {
    const db = databaseAt(55);
    seed(db, 55);
    const before = contents(db);
    db.exec("INSERT INTO schema_migrations VALUES(60,'now')");
    expect(() => migrateOpenBotDatabase(db)).toThrow("newer than this application supports");
    db.exec("DELETE FROM schema_migrations WHERE version=60; DELETE FROM schema_migrations WHERE version=20");
    expect(() => migrateOpenBotDatabase(db)).toThrow("missing version 20");
    expect(contents(db)).toEqual(before);
    expect(proxyTables(db)).toEqual([]);
  });

  it("refuses a bad proxy, and an assignment to no profile or no proxy", () => {
    const db = databaseAt(55);
    seed(db, 55);
    migrateOpenBotDatabase(db);
    expect(() => insertProxy(db, { proxy_id: "short" })).toThrow("CHECK constraint failed");
    expect(() => insertProxy(db, { scheme: "socks4" })).toThrow("CHECK constraint failed");
    expect(() => insertProxy(db, { port: 0 })).toThrow("CHECK constraint failed");
    expect(() => insertProxy(db, { port: 65_536 })).toThrow("CHECK constraint failed");
    expect(() => insertProxy(db, { host: "" })).toThrow("CHECK constraint failed");
    expect(() => insertProxy(db, { password: new Uint8Array([1, 2, 3]) })).toThrow("CHECK constraint failed");
    insertProxy(db, { username: "ana", password: new Uint8Array([1, 2, 3]) });
    const assign = db.prepare("INSERT INTO browser_profile_proxies (profile_id, proxy_id) VALUES (?, ?)");
    expect(() => assign.run("c".repeat(32), PROXY)).toThrow("FOREIGN KEY constraint failed");
    expect(() => assign.run(PROFILE, "c".repeat(32))).toThrow("FOREIGN KEY constraint failed");
    assign.run(PROFILE, PROXY);
    expect(() => assign.run(PROFILE, PROXY)).toThrow("UNIQUE constraint failed");
    expectHealthy(db);
  });

  it("keeps a computer proxy apart from an address, and one computer for each member", () => {
    const db = databaseAt(55);
    seed(db, 55);
    migrateOpenBotDatabase(db);
    const computer =
      db.prepare(`INSERT INTO browser_proxies (proxy_id, kind, scheme, host, port, member_id, created_at, updated_at)
      VALUES (?, 'computer', ?, ?, ?, ?, '2026-01-03', '2026-01-03')`);
    const address =
      db.prepare(`INSERT INTO browser_proxies (proxy_id, kind, scheme, host, port, member_id, created_at, updated_at)
      VALUES (?, 'address', 'http', 'proxy.example.net', 8080, ?, '2026-01-03', '2026-01-03')`);
    expect(() => computer.run(PROXY, null, null, null, null)).toThrow("CHECK constraint failed");
    expect(() => computer.run(PROXY, "socks5", "proxy.example.net", 1080, "member-1")).toThrow(
      "CHECK constraint failed",
    );
    expect(() => address.run(PROXY, "member-1")).toThrow("CHECK constraint failed");
    expect(() =>
      db
        .prepare(`INSERT INTO browser_proxies (proxy_id, kind, member_id, created_at, updated_at)
          VALUES (?, 'relay', 'member-1', '2026-01-03', '2026-01-03')`)
        .run(PROXY),
    ).toThrow("CHECK constraint failed");
    computer.run(PROXY, null, null, null, "member-1");
    expect(() => computer.run("c".repeat(32), null, null, null, "member-1")).toThrow("UNIQUE constraint failed");
    computer.run("c".repeat(32), null, null, null, "member-2");
    address.run("d".repeat(32), null);
    expect(db.prepare("SELECT proxy_id, kind, member_id FROM browser_proxies ORDER BY proxy_id").all()).toEqual([
      { proxy_id: PROXY, kind: "computer", member_id: "member-1" },
      { proxy_id: "c".repeat(32), kind: "computer", member_id: "member-2" },
      { proxy_id: "d".repeat(32), kind: "address", member_id: null },
    ]);
    db.prepare("INSERT INTO browser_profile_proxies (profile_id, proxy_id) VALUES (?, ?)").run(PROFILE, PROXY);
    expectHealthy(db);
  });

  it("drops the assignment with its proxy or its profile, and keeps the other row", () => {
    const db = databaseAt(55);
    seed(db, 55);
    migrateOpenBotDatabase(db);
    insertProxy(db);
    const assign = db.prepare("INSERT INTO browser_profile_proxies (profile_id, proxy_id) VALUES (?, ?)");
    assign.run(PROFILE, PROXY);
    db.prepare("DELETE FROM browser_proxies WHERE proxy_id = ?").run(PROXY);
    expect(db.prepare("SELECT * FROM browser_profile_proxies").all()).toEqual([]);
    expect(db.prepare("SELECT profile_id FROM browser_profiles").all()).toEqual([{ profile_id: PROFILE }]);
    insertProxy(db);
    assign.run(PROFILE, PROXY);
    db.prepare("DELETE FROM browser_profiles WHERE profile_id = ?").run(PROFILE);
    expect(db.prepare("SELECT * FROM browser_profile_proxies").all()).toEqual([]);
    expect(db.prepare("SELECT proxy_id FROM browser_proxies").all()).toEqual([{ proxy_id: PROXY }]);
    expectHealthy(db);
  });
});
