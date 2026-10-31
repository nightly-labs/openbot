import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function migratedTo(lastExclusive: string): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec("PRAGMA foreign_keys = ON");
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql") && name < lastExclusive)
    .sort()) {
    database.exec(readFileSync(new URL(name, migrations), "utf8"));
  }
  return database;
}

const migration = readFileSync(new URL("../migrations/0046_remote_session_indexes.sql", import.meta.url), "utf8");

const SESSION_COLUMNS =
  "session_id, host_id, user_id, membership_id, started_at, ended_at, expires_at, auth_session_hash";

function seed(database: DatabaseSync) {
  database.exec(`
    INSERT INTO users(id, identity_key, email, created_at, updated_at)
      VALUES ('owner', 'email:owner', 'owner@example.com', 1, 1),
             ('member', 'email:member', 'member@example.com', 1, 1);
    INSERT INTO remote_hosts(host_id, owner_user_id, name, auth_epoch, created_at, updated_at)
      VALUES ('office', 'owner', 'Office', 1, 10, 10),
             ('laptop', 'owner', 'Laptop', 1, 10, 10);
    INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
      VALUES ('office-owner', 'office', 'owner', 'owner', 'active', 10, 10),
             ('office-member', 'office', 'member', 'member', 'active', 10, 10),
             ('laptop-owner', 'laptop', 'owner', 'owner', 'active', 10, 10);
    INSERT INTO remote_sessions(${SESSION_COLUMNS})
      VALUES ('ended-1', 'office', 'member', 'office-member', 20, 30, 40, 'device-a'),
             ('ended-2', 'office', 'member', 'office-member', 50, 60, 70, NULL),
             ('active-device', 'office', 'member', 'office-member', 80, NULL, 8640000000000000, 'device-a'),
             ('active-legacy', 'office', 'owner', 'office-owner', 90, NULL, 100, NULL),
             ('laptop-active', 'laptop', 'owner', 'laptop-owner', 110, NULL, 8640000000000000, 'device-b');
  `);
}

function plan(database: DatabaseSync, sql: string): string {
  return database
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all()
    .map((row) => String(row.detail))
    .join("\n");
}

describe("remote session indexes migration", () => {
  it("keeps every session and lets the active-session sweep and membership cascade use an index", () => {
    const database = migratedTo("0046");
    seed(database);
    const before = database.prepare(`SELECT ${SESSION_COLUMNS} FROM remote_sessions ORDER BY session_id`).all();

    database.exec(migration);

    expect(database.prepare(`SELECT ${SESSION_COLUMNS} FROM remote_sessions ORDER BY session_id`).all()).toEqual(
      before,
    );
    expect(
      plan(
        database,
        "UPDATE remote_sessions SET ended_at = 1 WHERE host_id = 'office' AND user_id = 'owner' AND ended_at IS NULL AND expires_at <= 1",
      ),
    ).toContain("remote_sessions_active_host_user");
    const cascade = plan(database, "DELETE FROM remote_memberships WHERE host_id = 'office'");
    expect(cascade).toContain("remote_sessions_membership_id");
    expect(cascade).not.toContain("SCAN remote_sessions");
  });

  it("still sweeps only expired active sessions and cascades a membership delete to its sessions", () => {
    const database = migratedTo("0046");
    seed(database);
    database.exec(migration);

    database
      .prepare(
        "UPDATE remote_sessions SET ended_at = ? WHERE host_id = ? AND user_id = ? AND ended_at IS NULL AND expires_at <= ?",
      )
      .run(200, "office", "owner", 200);
    database.prepare("DELETE FROM remote_memberships WHERE host_id = ?").run("laptop");

    expect(database.prepare("SELECT session_id, ended_at FROM remote_sessions ORDER BY session_id").all()).toEqual([
      { session_id: "active-device", ended_at: null },
      { session_id: "active-legacy", ended_at: 200 },
      { session_id: "ended-1", ended_at: 30 },
      { session_id: "ended-2", ended_at: 60 },
    ]);
  });
});
