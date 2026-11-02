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

const migration = readFileSync(new URL("../migrations/0044_remote_signal_homes.sql", import.meta.url), "utf8");

function seed(database: DatabaseSync) {
  database.exec(`
    INSERT INTO users(id, identity_key, email, created_at, updated_at)
      VALUES ('owner', 'email:owner', 'owner@example.com', 1, 1);
    INSERT INTO remote_hosts(host_id, owner_user_id, name, logo_key, device_public_key, machine_token_hash,
        auth_epoch, created_at, updated_at)
      VALUES ('registered', 'owner', 'Office', 'logo-1', 'public-key', 'token-hash', 3, 10, 20),
             ('plain', 'owner', 'Laptop', NULL, NULL, NULL, 1, 30, 40);
    INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
      VALUES ('membership-owner', 'registered', 'owner', 'owner', 'active', 10, 10);
    INSERT INTO remote_auth_events(event_id, payload, created_at, attempts, next_attempt_at)
      VALUES ('new', '{"type":"account-profile-changed","userId":"owner"}', 50, 0, 50),
             ('retried', '{"type":"servers-changed","userId":"owner"}', 60, 4, 900);
  `);
}

describe("remote Signal homes migration", () => {
  it("keeps every host and pending auth event, and starts each one with no home and all targets", () => {
    const database = migratedTo("0044");
    seed(database);
    database.exec(migration);
    expect(
      database
        .prepare(
          `SELECT host_id, owner_user_id, name, logo_key, device_public_key, machine_token_hash, auth_epoch,
             created_at, updated_at, signal_home FROM remote_hosts ORDER BY host_id`,
        )
        .all(),
    ).toEqual([
      {
        host_id: "plain",
        owner_user_id: "owner",
        name: "Laptop",
        logo_key: null,
        device_public_key: null,
        machine_token_hash: null,
        auth_epoch: 1,
        created_at: 30,
        updated_at: 40,
        signal_home: null,
      },
      {
        host_id: "registered",
        owner_user_id: "owner",
        name: "Office",
        logo_key: "logo-1",
        device_public_key: "public-key",
        machine_token_hash: "token-hash",
        auth_epoch: 3,
        created_at: 10,
        updated_at: 20,
        signal_home: null,
      },
    ]);
    expect(
      database
        .prepare(
          "SELECT event_id, payload, created_at, attempts, next_attempt_at, pending_targets FROM remote_auth_events ORDER BY event_id",
        )
        .all(),
    ).toEqual([
      {
        event_id: "new",
        payload: '{"type":"account-profile-changed","userId":"owner"}',
        created_at: 50,
        attempts: 0,
        next_attempt_at: 50,
        pending_targets: null,
      },
      {
        event_id: "retried",
        payload: '{"type":"servers-changed","userId":"owner"}',
        created_at: 60,
        attempts: 4,
        next_attempt_at: 900,
        pending_targets: null,
      },
    ]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM remote_memberships").get()).toEqual({ count: 1 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("accepts the writes of the Worker that runs before the deploy", () => {
    const database = migratedTo("0044");
    seed(database);
    database.exec(migration);
    // The deployed Worker names neither new column in its inserts, updates and deletes.
    database.exec(`
      INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
        VALUES ('old-worker', 'owner', 'New host', 70, 70);
      UPDATE remote_hosts SET auth_epoch = auth_epoch + 1, updated_at = 80 WHERE host_id = 'registered';
      INSERT INTO remote_auth_events(event_id, payload, created_at, attempts, next_attempt_at)
        VALUES ('old-worker', '{"type":"account-profile-changed","userId":"owner"}', 70, 0, 70);
      UPDATE remote_auth_events SET attempts = attempts + 1, next_attempt_at = 1000 WHERE event_id = 'retried';
      DELETE FROM remote_auth_events WHERE event_id = 'new';
    `);
    expect(database.prepare("SELECT host_id, signal_home FROM remote_hosts ORDER BY host_id").all()).toEqual([
      { host_id: "old-worker", signal_home: null },
      { host_id: "plain", signal_home: null },
      { host_id: "registered", signal_home: null },
    ]);
    expect(
      database
        .prepare(
          "SELECT event_id, attempts, next_attempt_at, pending_targets FROM remote_auth_events ORDER BY event_id",
        )
        .all(),
    ).toEqual([
      { event_id: "old-worker", attempts: 0, next_attempt_at: 70, pending_targets: null },
      { event_id: "retried", attempts: 5, next_attempt_at: 1000, pending_targets: null },
    ]);
  });
});
