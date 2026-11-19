import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const MIGRATION = "0056_host_appearance.sql";

function beforeMigration(): DatabaseSync {
  const database = migratedDatabase("0055_operator_host_assignment.sql");
  databases.push(database);
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
    VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Owner', NULL, 1, 1),
           ('member', 'email:member@example.test', 'member@example.test', 'Member', NULL, 1, 1);
    INSERT INTO remote_hosts(host_id, owner_user_id, name, logo_key, device_public_key, machine_token_hash,
        auth_epoch, created_at, updated_at, signal_home)
      VALUES ('office', 'owner', 'Office', 'logo-1', 'public-key', 'token-hash', 3, 10, 20, 'eu'),
             ('laptop', 'owner', 'Laptop', NULL, NULL, NULL, 1, 30, 40, NULL);
    INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
      VALUES ('membership-owner', 'office', 'owner', 'owner', 'active', 10, 10),
             ('membership-member', 'office', 'member', 'member', 'active', 11, 11);
  `);
  return database;
}

const hosts = (database: DatabaseSync) => database.prepare("SELECT * FROM remote_hosts ORDER BY host_id").all();

describe("host appearance migration", () => {
  it("keeps every host and membership, and gives each host the automatic look", () => {
    const database = beforeMigration();
    const before = hosts(database);
    const memberships = database.prepare("SELECT * FROM remote_memberships ORDER BY membership_id").all();

    database.exec("BEGIN");
    database.exec(migration(MIGRATION));
    database.exec("COMMIT");

    expect(hosts(database)).toEqual(before.map((row) => ({ ...row, appearance_shape: null, appearance_color: null })));
    expect(database.prepare("SELECT * FROM remote_memberships ORDER BY membership_id").all()).toEqual(memberships);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("accepts the writes and reads of the Worker that runs before the deploy", () => {
    const database = beforeMigration();
    database.exec(migration(MIGRATION));
    // Host registration and the logo update of the Worker before: they name no new column.
    database.exec(`
      INSERT INTO remote_hosts(
        host_id, owner_user_id, name, device_public_key, machine_token_hash, auth_epoch, created_at, updated_at
      ) VALUES ('office', 'owner', 'Office 2', 'public-key-2', 'token-hash-2', 1, 50, 50)
      ON CONFLICT(host_id) DO UPDATE SET
        name = excluded.name,
        device_public_key = excluded.device_public_key,
        machine_token_hash = excluded.machine_token_hash,
        auth_epoch = remote_hosts.auth_epoch + 1,
        updated_at = excluded.updated_at
      WHERE remote_hosts.owner_user_id = excluded.owner_user_id;
      UPDATE remote_hosts SET logo_key = 'logo-2', updated_at = 60 WHERE host_id = 'laptop';
    `);
    // The host list of the Worker before.
    expect(
      database
        .prepare(
          `SELECT h.host_id, h.name, h.logo_key, h.auth_epoch, m.role
           FROM remote_memberships m JOIN remote_hosts h ON h.host_id = m.host_id
           WHERE m.user_id = 'owner' AND m.status = 'active' ORDER BY h.name, h.host_id`,
        )
        .all(),
    ).toEqual([{ host_id: "office", name: "Office 2", logo_key: "logo-1", auth_epoch: 4, role: "owner" }]);
  });

  it("stores and clears a chosen look, and a new registration keeps it", () => {
    const database = beforeMigration();
    database.exec(migration(MIGRATION));
    database.exec(
      "UPDATE remote_hosts SET appearance_shape = 'nuage', appearance_color = '#ff8800', updated_at = 70 WHERE host_id = 'office'",
    );
    database.exec(
      "UPDATE remote_hosts SET appearance_shape = 'galet', appearance_color = NULL, updated_at = 71 WHERE host_id = 'laptop'",
    );
    database.exec(`
      INSERT INTO remote_hosts(
        host_id, owner_user_id, name, device_public_key, machine_token_hash, auth_epoch, created_at, updated_at
      ) VALUES ('office', 'owner', 'Office', 'public-key', 'token-hash-3', 1, 80, 80)
      ON CONFLICT(host_id) DO UPDATE SET name = excluded.name, machine_token_hash = excluded.machine_token_hash,
        updated_at = excluded.updated_at
      WHERE remote_hosts.owner_user_id = excluded.owner_user_id;
    `);
    const looks = () =>
      database.prepare("SELECT host_id, appearance_shape, appearance_color FROM remote_hosts ORDER BY host_id").all();
    expect(looks()).toEqual([
      { host_id: "laptop", appearance_shape: "galet", appearance_color: null },
      { host_id: "office", appearance_shape: "nuage", appearance_color: "#ff8800" },
    ]);
    database.exec("UPDATE remote_hosts SET appearance_shape = NULL, appearance_color = NULL WHERE host_id = 'office'");
    expect(looks()).toEqual([
      { host_id: "laptop", appearance_shape: "galet", appearance_color: null },
      { host_id: "office", appearance_shape: null, appearance_color: null },
    ]);
  });
});
