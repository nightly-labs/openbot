import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const PUBLIC_KEY = `B${"A".repeat(86)}`;
const WATCH_COLUMNS =
  "watch_session_id, user_id, auth_session_hash, token_hash, public_key, created_at, expires_at, last_used_at";

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  sessions: database.prepare("SELECT * FROM auth_sessions ORDER BY id").all(),
  mobile: database.prepare("SELECT * FROM mobile_auth_sessions ORDER BY session_id").all(),
  remote: database.prepare("SELECT * FROM remote_sessions ORDER BY session_id").all(),
  events: database.prepare("SELECT COUNT(*) AS count FROM remote_auth_events").get(),
});

function seeded(): DatabaseSync {
  const database = migratedDatabase("0076_near_wallet_agents.sql");
  databases.push(database);
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
    VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Ana Lopez', NULL, 1, 1),
           ('member', 'email:member@example.test', 'member@example.test', NULL, NULL, 1, 1);
    INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at, revoked_at)
    VALUES ('phone', 'owner', 'phone-hash', 9000, 1, 2, NULL),
           ('desktop', 'owner', 'desktop-hash', 9000, 1, 3, NULL),
           ('old-phone', 'member', 'old-hash', 9000, 1, 2, 5);
    INSERT INTO mobile_auth_sessions(session_id, user_id, device_id, device_name, platform, created_at)
    VALUES ('phone', 'owner', 'device-1', 'iPhone', 'ios', 1),
           ('old-phone', 'member', 'device-2', 'Pixel', 'android', 1);
    INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
    VALUES ('host-1', 'owner', 'Studio', 1, 1);
    INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
    VALUES ('membership-1', 'host-1', 'owner', 'owner', 'active', 1, 1);
    INSERT INTO remote_sessions(session_id, host_id, user_id, membership_id, started_at, expires_at, auth_session_hash)
    VALUES ('remote-1', 'host-1', 'owner', 'membership-1', 1, 9000, 'phone-hash');
  `);
  return database;
}

function migrated(): DatabaseSync {
  const database = seeded();
  database.exec("BEGIN");
  database.exec(migration("0077_watch_sessions.sql"));
  database.exec("COMMIT");
  return database;
}

describe("watch sessions migration", () => {
  it("keeps every account, session, phone and remote session, and starts with no watch sessions", () => {
    const database = seeded();
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0077_watch_sessions.sql"));
    database.exec("COMMIT");

    expect(snapshot(database)).toEqual(before);
    expect(database.prepare("SELECT COUNT(*) AS count FROM watch_sessions").get()).toEqual({ count: 0 });
  });

  it("revokes the watch sessions of a revoked account session and keeps the remote session trigger", () => {
    const database = migrated();
    database.exec(`
      INSERT INTO watch_sessions(${WATCH_COLUMNS})
      VALUES ('watch-1', 'owner', 'phone-hash', 'watch-hash-1', '${PUBLIC_KEY}', 10, 8000, 10),
             ('watch-2', 'owner', 'desktop-hash', 'watch-hash-2', '${PUBLIC_KEY}', 11, 8000, 11);
      UPDATE auth_sessions SET revoked_at = 20 WHERE id = 'phone';
    `);

    expect(database.prepare("SELECT watch_session_id, revoked_at FROM watch_sessions ORDER BY 1").all()).toEqual([
      { watch_session_id: "watch-1", revoked_at: 20 },
      { watch_session_id: "watch-2", revoked_at: null },
    ]);
    expect(database.prepare("SELECT ended_at FROM remote_sessions WHERE session_id = 'remote-1'").get()).toEqual({
      ended_at: 20,
    });
  });

  it("deletes the watch sessions with their account session and their account", () => {
    const database = migrated();
    database.exec(`
      INSERT INTO watch_sessions(${WATCH_COLUMNS})
      VALUES ('watch-1', 'owner', 'phone-hash', 'watch-hash-1', '${PUBLIC_KEY}', 10, 8000, 10),
             ('watch-2', 'owner', 'desktop-hash', 'watch-hash-2', '${PUBLIC_KEY}', 11, 8000, 11);
      DELETE FROM auth_sessions WHERE id = 'phone';
    `);
    expect(database.prepare("SELECT watch_session_id FROM watch_sessions").all()).toEqual([
      { watch_session_id: "watch-2" },
    ]);

    database.exec("DELETE FROM users WHERE id = 'owner'");
    expect(database.prepare("SELECT COUNT(*) AS count FROM watch_sessions").get()).toEqual({ count: 0 });
  });

  it("refuses a public key that is not a raw P-256 key, an unknown parent and a reused token hash", () => {
    const database = migrated();
    const insert = (id: string, parent: string, tokenHash: string, key: string) =>
      database.exec(`INSERT INTO watch_sessions(${WATCH_COLUMNS})
        VALUES ('${id}', 'owner', '${parent}', '${tokenHash}', '${key}', 10, 8000, 10)`);

    expect(() => insert("short", "phone-hash", "hash-a", "BAAA")).toThrow();
    expect(() => insert("compressed", "phone-hash", "hash-b", `A${"A".repeat(86)}`)).toThrow();
    expect(() => insert("orphan", "missing-hash", "hash-c", PUBLIC_KEY)).toThrow();
    insert("watch-1", "phone-hash", "hash-d", PUBLIC_KEY);
    expect(() => insert("watch-2", "phone-hash", "hash-d", PUBLIC_KEY)).toThrow();
  });
});
