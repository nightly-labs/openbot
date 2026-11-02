import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SERVER_MEMBER_LIMIT_SQL } from "../src/server/billing-entitlement";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("server member limits migration", () => {
  it("keeps host rows, accepts old Worker writes, and can run again", () => {
    const database = migratedDatabase("0039_remote_host_key_handovers.sql");
    databases.push(database);
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Owner', NULL, 1, 1),
             ('other', 'email:other@example.test', 'other@example.test', 'Other', NULL, 1, 1);
      INSERT INTO remote_hosts(host_id, owner_user_id, name, device_public_key, machine_token_hash, auth_epoch, created_at, updated_at)
      VALUES ('host-1', 'owner', 'Studio', 'key-a', 'token-hash', 4, 1, 1);
      INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
      VALUES ('m-owner', 'host-1', 'owner', 'owner', 'active', 1, 1);
      INSERT INTO hosted_servers(server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state, observed_state, idempotency_key, created_at, updated_at)
      VALUES ('hosted-1', 'owner', 'Cloud', 'small', 'starter', 'month', 'eur', 'running', 'creating', 'key-1', 1, 1);
    `);
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0040_server_member_limits.sql"));
    database.exec("COMMIT");
    database.exec(migration("0040_server_member_limits.sql"));

    expect(snapshot(database)).toEqual(before);
    // The old Worker's host registration still runs.
    database.exec(`
      UPDATE remote_hosts SET device_public_key = 'key-b', auth_epoch = auth_epoch + 1, updated_at = 2
       WHERE host_id = 'host-1' AND owner_user_id = 'owner';
    `);
    expect(
      database.prepare("SELECT device_public_key, auth_epoch FROM remote_hosts WHERE host_id = 'host-1'").get(),
    ).toEqual({ device_public_key: "key-b", auth_epoch: 5 });

    const insert = database.prepare(
      "INSERT INTO server_member_limits(server_id, owner_user_id, member_limit, created_at, updated_at) VALUES (?, ?, ?, 3, 3)",
    );
    insert.run("host-1", "owner", 40);
    // A hosted server that has not published its host yet can have a limit too.
    insert.run("hosted-1", "owner", 60);
    expect(() => insert.run("host-1", "owner", 50)).toThrow();
    // A host stores at most 100 members, and a limit is a whole number.
    for (const limit of [0, 101, 2.5]) expect(() => insert.run("host-2", "owner", limit)).toThrow();
    expect(() => insert.run("host-2", "missing", 10)).toThrow();

    // The query of RemoteControlPlane.#memberLimit.
    const customLimit = (serverId: string) => database.prepare(SERVER_MEMBER_LIMIT_SQL).get(serverId);
    expect(customLimit("host-1")).toEqual({ member_limit: 40 });
    expect(customLimit("hosted-1")).toEqual({ member_limit: 60 });

    // A host that the owner deletes and registers again keeps its limit. Another account that
    // registers the same ID gets nothing.
    database.exec("DELETE FROM remote_hosts WHERE host_id = 'host-1'");
    expect(customLimit("host-1")).toBeUndefined();
    const register = database.prepare(
      "INSERT INTO remote_hosts(host_id, owner_user_id, name, auth_epoch, created_at, updated_at) VALUES ('host-1', ?, 'Studio', 1, 4, 4)",
    );
    register.run("other");
    expect(customLimit("host-1")).toBeUndefined();
    database.exec("DELETE FROM remote_hosts WHERE host_id = 'host-1'");
    register.run("owner");
    expect(customLimit("host-1")).toEqual({ member_limit: 40 });

    // The rows stop with their account.
    insert.run("host-3", "other", 10);
    database.exec("DELETE FROM users WHERE id = 'other'");
    expect(database.prepare("SELECT server_id FROM server_member_limits ORDER BY server_id").all()).toEqual([
      { server_id: "host-1" },
      { server_id: "hosted-1" },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });
});

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  hosts: database.prepare("SELECT * FROM remote_hosts ORDER BY host_id").all(),
  memberships: database.prepare("SELECT * FROM remote_memberships ORDER BY membership_id").all(),
  hosted: database.prepare("SELECT * FROM hosted_servers ORDER BY server_id").all(),
});
