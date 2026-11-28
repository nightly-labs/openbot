import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const LATER = 9_999_999_999_999;

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  sessions: database.prepare("SELECT * FROM auth_sessions ORDER BY id").all(),
  mobile: database.prepare("SELECT * FROM mobile_auth_sessions ORDER BY session_id").all(),
  remote: database.prepare("SELECT * FROM remote_sessions ORDER BY session_id").all(),
  watch: database.prepare("SELECT * FROM watch_sessions ORDER BY watch_session_id").all(),
});

const changes = (database: DatabaseSync) =>
  database.prepare("SELECT kind, subject_id FROM auth_session_changes ORDER BY id").all();

function seeded(): DatabaseSync {
  const database = migratedDatabase("0079_credit_welcome_inboxes.sql");
  databases.push(database);
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
    VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Ana Lopez', NULL, 1, 1),
           ('member', 'email:member@example.test', 'member@example.test', NULL, NULL, 1, 1);
    INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at, revoked_at)
    VALUES ('phone', 'owner', 'phone-hash', ${LATER}, 1, 2, NULL),
           ('desktop', 'owner', 'desktop-hash', ${LATER}, 1, 3, NULL),
           ('old-phone', 'member', 'old-hash', ${LATER}, 1, 2, 5),
           ('expired', 'member', 'expired-hash', 10, 1, 2, NULL),
           ('member-desktop', 'member', 'member-hash', ${LATER}, 1, 2, NULL);
    INSERT INTO mobile_auth_sessions(session_id, user_id, device_id, device_name, platform, created_at)
    VALUES ('phone', 'owner', 'device-1', 'iPhone', 'ios', 1),
           ('old-phone', 'member', 'device-2', 'Pixel', 'android', 1),
           ('expired', 'member', 'device-3', 'Pixel', 'android', 1);
    INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
    VALUES ('host-1', 'owner', 'Studio', 1, 1);
    INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
    VALUES ('membership-1', 'host-1', 'owner', 'owner', 'active', 1, 1);
    INSERT INTO remote_sessions(session_id, host_id, user_id, membership_id, started_at, expires_at, auth_session_hash)
    VALUES ('remote-1', 'host-1', 'owner', 'membership-1', 1, ${LATER}, 'phone-hash');
    INSERT INTO watch_sessions(watch_session_id, user_id, auth_session_hash, token_hash, public_key, created_at, expires_at, last_used_at)
    VALUES ('watch-1', 'owner', 'phone-hash', 'watch-hash-1', 'B${"A".repeat(86)}', 10, ${LATER}, 10);
  `);
  return database;
}

function migrated(): DatabaseSync {
  const database = seeded();
  database.exec("BEGIN");
  database.exec(migration("0083_auth_session_changes.sql"));
  database.exec("COMMIT");
  return database;
}

describe("auth session changes migration", () => {
  it("keeps every account, session, phone, remote and watch session, and starts with no changes", () => {
    const database = seeded();
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0083_auth_session_changes.sql"));
    database.exec("COMMIT");

    expect(snapshot(database)).toEqual(before);
    expect(changes(database)).toEqual([]);
  });

  it("records a revoke, a shorter expiry and a new token, and keeps the older revoke triggers", () => {
    const database = migrated();
    database.exec(`
      UPDATE auth_sessions SET revoked_at = 20 WHERE id = 'phone';
      UPDATE auth_sessions SET revoked_at = 30 WHERE id = 'old-phone';
      UPDATE auth_sessions SET expires_at = ${LATER - 1} WHERE id = 'desktop';
      UPDATE auth_sessions SET expires_at = ${LATER + 1} WHERE id = 'member-desktop';
      UPDATE auth_sessions SET token_hash = 'member-hash-2' WHERE id = 'member-desktop';
      UPDATE auth_sessions SET last_used_at = 40 WHERE id = 'desktop';
    `);

    expect(changes(database)).toEqual([
      { kind: "session", subject_id: "phone" },
      { kind: "session", subject_id: "desktop" },
      { kind: "session", subject_id: "member-desktop" },
    ]);
    expect(database.prepare("SELECT ended_at FROM remote_sessions WHERE session_id = 'remote-1'").get()).toEqual({
      ended_at: 20,
    });
    expect(database.prepare("SELECT revoked_at FROM watch_sessions WHERE watch_session_id = 'watch-1'").get()).toEqual({
      revoked_at: 20,
    });
  });

  it("records a phone sign-out of a live session only, and not a phone sign-in", () => {
    const database = migrated();
    database.exec(`
      INSERT INTO mobile_auth_sessions(session_id, user_id, device_id, device_name, platform, created_at)
      VALUES ('desktop', 'owner', 'device-4', 'iPad', 'ios', 50);
      DELETE FROM mobile_auth_sessions WHERE session_id = 'phone';
      DELETE FROM mobile_auth_sessions WHERE session_id = 'old-phone';
    `);

    expect(changes(database)).toEqual([{ kind: "session", subject_id: "phone" }]);
    database.exec(`
      INSERT INTO mobile_auth_sessions(session_id, user_id, device_id, device_name, platform, created_at)
      VALUES ('old-phone', 'member', 'device-5', 'Pixel', 'android', 60);
    `);
    expect(changes(database)).toEqual([{ kind: "session", subject_id: "phone" }]);
  });

  it("records a changed profile field and an account delete, and skips an update that changes nothing", () => {
    const database = migrated();
    database.exec(`
      UPDATE users SET name = 'Ana Lopez', updated_at = 60 WHERE id = 'owner';
      UPDATE users SET avatar_url = NULL WHERE id = 'owner';
      UPDATE users SET name = 'Ana L.' WHERE id = 'owner';
      UPDATE users SET analytics_enabled = 0 WHERE id = 'member';
      UPDATE users SET chat_color = '#12ab34' WHERE id = 'member';
      UPDATE users SET email = 'new@example.test' WHERE id = 'member';
      DELETE FROM users WHERE id = 'owner';
    `);

    const recorded = changes(database).map((row) => `${row.kind}:${row.subject_id}`);
    expect(recorded.slice(0, 4)).toEqual(["user:owner", "user:member", "user:member", "user:member"]);
    expect(recorded.at(-1)).toBe("user:owner");
    expect(new Set(recorded.slice(4, -1))).toEqual(new Set(["session:desktop", "session:phone"]));
    expect(database.prepare("SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id = 'owner'").get()).toEqual({
      count: 0,
    });
  });

  it("records no change when the retention cleanup deletes revoked and expired sessions", () => {
    const database = migrated();
    database.exec("DELETE FROM auth_sessions WHERE revoked_at IS NOT NULL OR expires_at <= 100");

    expect(changes(database)).toEqual([]);
    expect(database.prepare("SELECT session_id FROM mobile_auth_sessions ORDER BY 1").all()).toEqual([
      { session_id: "phone" },
    ]);
  });

  it("refuses an unknown change kind", () => {
    const database = migrated();
    expect(() =>
      database.exec("INSERT INTO auth_session_changes(kind, subject_id, changed_at) VALUES ('device', 'x', 1)"),
    ).toThrow();
  });
});
