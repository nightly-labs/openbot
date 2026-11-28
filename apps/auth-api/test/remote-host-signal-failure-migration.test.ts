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

const migration = readFileSync(new URL("../migrations/0080_remote_host_signal_failure.sql", import.meta.url), "utf8");

const RELEASED_HOST_SQL = `SELECT host_id, owner_user_id, name, logo_key, auth_epoch, machine_token_hash, device_public_key, signal_home
  FROM remote_hosts WHERE host_id = ? LIMIT 1`;
const RELEASED_STORE_SQL = "UPDATE remote_hosts SET signal_home = ? WHERE host_id = ? AND signal_home IS ?";

function seed(database: DatabaseSync) {
  database.exec(`
    INSERT INTO users(id, identity_key, email, created_at, updated_at)
      VALUES ('owner', 'email:owner', 'owner@example.com', 1, 1);
    INSERT INTO remote_hosts(host_id, owner_user_id, name, logo_key, device_public_key, machine_token_hash,
        auth_epoch, created_at, updated_at, signal_home, appearance_shape, appearance_color)
      VALUES ('homed', 'owner', 'Office', 'logo-1', 'public-key', 'token-hash', 3, 10, 20, 'us', 'circle', 'blue'),
             ('plain', 'owner', 'Laptop', NULL, NULL, NULL, 1, 30, 40, NULL, NULL, NULL);
    INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
      VALUES ('membership-owner', 'homed', 'owner', 'owner', 'active', 10, 10);
  `);
}

function rows(database: DatabaseSync, table: string) {
  return database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
}

describe("remote host Signal failure migration", () => {
  it("keeps every host and membership, starts with no failed home, and keeps the released statements working", () => {
    const database = migratedTo("0080");
    seed(database);
    const hostsBefore = rows(database, "remote_hosts");
    const membershipsBefore = rows(database, "remote_memberships");
    const releasedBefore = database.prepare(RELEASED_HOST_SQL).get("homed");

    database.exec(migration);

    expect(rows(database, "remote_hosts")).toEqual(
      hostsBefore.map((host) => ({ ...host, signal_home_failed: null, signal_home_failed_at: null })),
    );
    expect(rows(database, "remote_memberships")).toEqual(membershipsBefore);
    expect(database.prepare(RELEASED_HOST_SQL).get("homed")).toEqual(releasedBefore);
    expect(database.prepare(RELEASED_STORE_SQL).run("a", "homed", "us").changes).toBe(1);
    expect(
      database
        .prepare(
          `UPDATE remote_hosts SET signal_home = ?, signal_home_failed = ?, signal_home_failed_at = ?
           WHERE host_id = ? AND signal_home IS ?`,
        )
        .run("b", "a", 500, "homed", "a").changes,
    ).toBe(1);
    expect(
      database
        .prepare("SELECT signal_home, signal_home_failed, signal_home_failed_at FROM remote_hosts WHERE host_id = ?")
        .get("homed"),
    ).toEqual({ signal_home: "b", signal_home_failed: "a", signal_home_failed_at: 500 });
    expect(
      database
        .prepare("SELECT signal_home, signal_home_failed, signal_home_failed_at FROM remote_hosts WHERE host_id = ?")
        .get("plain"),
    ).toEqual({ signal_home: null, signal_home_failed: null, signal_home_failed_at: null });
  });
});
