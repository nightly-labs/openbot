import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("remote host key handover migration", () => {
  it("keeps host rows, accepts old Worker writes, and can run again", () => {
    const database = migratedDatabase("0038_licenses.sql");
    databases.push(database);
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Owner', NULL, 1, 1);
      INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
      VALUES ('desktop', 'owner', 'desktop-hash', 999, 1, 1);
      INSERT INTO remote_hosts(host_id, owner_user_id, name, device_public_key, machine_token_hash, auth_epoch, created_at, updated_at)
      VALUES ('host-1', 'owner', 'Studio', 'key-a', 'token-hash', 4, 1, 1),
             ('host-2', 'owner', 'Laptop', NULL, NULL, 1, 1, 1);
      INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
      VALUES ('m-owner', 'host-1', 'owner', 'owner', 'active', 1, 1);
      INSERT INTO mobile_connect_links(link_hash, user_id, desktop_session_id, host_id, host_fingerprint, created_at)
      VALUES ('link-1', 'owner', 'desktop', 'host-1', 'fingerprint-a', 1);
    `);
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0039_remote_host_key_handovers.sql"));
    database.exec("COMMIT");
    database.exec(migration("0039_remote_host_key_handovers.sql"));

    expect(snapshot(database)).toEqual(before);
    // The old Worker's host registration and Mobile Connect writes still run.
    database.exec(`
      UPDATE remote_hosts SET device_public_key = 'key-b', auth_epoch = auth_epoch + 1, updated_at = 2
       WHERE host_id = 'host-1' AND owner_user_id = 'owner';
      UPDATE mobile_connect_links SET revoked_at = 2 WHERE host_id = 'host-1' AND revoked_at IS NULL;
    `);
    expect(
      database.prepare("SELECT device_public_key, auth_epoch FROM remote_hosts WHERE host_id = 'host-1'").get(),
    ).toEqual({ device_public_key: "key-b", auth_epoch: 5 });

    const insert = database.prepare(
      `INSERT INTO remote_host_key_handovers(
        handover_id, host_id, issued_at, previous_public_key, public_key, previous_signature, signature, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run("h-1", "host-1", 10, "key-b", "key-c", "sig-b", "sig-c", 3);
    // A step to the same key, a repeated step, and a step for a host that does not exist are refused.
    expect(() => insert.run("h-2", "host-1", 11, "key-c", "key-c", "sig-c", "sig-c2", 4)).toThrow();
    expect(() => insert.run("h-3", "host-1", 12, "key-b", "key-c", "sig-b2", "sig-c", 4)).toThrow();
    expect(() => insert.run("h-4", "missing", 12, "key-c", "key-d", "sig-c", "sig-d", 4)).toThrow();
    expect(() => insert.run("h-5", "host-1", -1, "key-c", "key-d", "sig-c", "sig-d", 4)).toThrow();
    insert.run("h-6", "host-2", 10, "key-x", "key-y", "sig-x", "sig-y", 4);
    expect(
      database
        .prepare("SELECT handover_id FROM remote_host_key_handovers WHERE host_id = ? ORDER BY issued_at")
        .all("host-1"),
    ).toEqual([{ handover_id: "h-1" }]);

    // A host that the old Worker deletes takes its handovers with it, and an account takes its hosts.
    database.exec("DELETE FROM remote_hosts WHERE host_id = 'host-2'");
    expect(database.prepare("SELECT handover_id FROM remote_host_key_handovers").all()).toEqual([
      { handover_id: "h-1" },
    ]);
    database.exec("DELETE FROM users WHERE id = 'owner'");
    expect(database.prepare("SELECT COUNT(*) AS count FROM remote_host_key_handovers").get()).toEqual({ count: 0 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });
});

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  hosts: database.prepare("SELECT * FROM remote_hosts ORDER BY host_id").all(),
  memberships: database.prepare("SELECT * FROM remote_memberships ORDER BY membership_id").all(),
  links: database.prepare("SELECT * FROM mobile_connect_links ORDER BY link_hash").all(),
});
