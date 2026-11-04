import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { bucketHasRoomSql, SERVER_SITE_LIMIT_SQL } from "../src/server/hosted-site-server";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("server site limits migration", () => {
  it("keeps host rows, accepts old Worker writes, and can run again", () => {
    const database = migratedDatabase("0047_company_sign_in.sql");
    databases.push(database);
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Owner', NULL, 1, 1),
             ('other', 'email:other@example.test', 'other@example.test', 'Other', NULL, 1, 1);
      INSERT INTO remote_hosts(host_id, owner_user_id, name, device_public_key, machine_token_hash, auth_epoch, created_at, updated_at)
      VALUES ('host-1', 'owner', 'Studio', 'key-a', 'token-hash', 4, 1, 1);
      INSERT INTO hosted_servers(server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state, observed_state, idempotency_key, created_at, updated_at)
      VALUES ('hosted-1', 'owner', 'Cloud', 'small', 'starter', 'month', 'eur', 'running', 'creating', 'key-1', 1, 1);
    `);
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0048_server_site_limits.sql"));
    database.exec("COMMIT");
    database.exec(migration("0048_server_site_limits.sql"));

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
      "INSERT INTO server_site_limits(server_id, owner_user_id, site_limit, created_at, updated_at) VALUES (?, ?, ?, 3, 3)",
    );
    insert.run("host-1", "owner", 200);
    // A hosted server that has not published its host yet can have a limit too.
    insert.run("hosted-1", "owner", 75);
    expect(() => insert.run("host-1", "owner", 50)).toThrow();
    // A limit is a whole number from 1 to 1000.
    for (const limit of [0, 1001, 2.5]) expect(() => insert.run("host-2", "owner", limit)).toThrow();
    expect(() => insert.run("host-2", "missing", 10)).toThrow();

    // The query of hostedSiteLimit.
    const customLimit = (serverId: string) => database.prepare(SERVER_SITE_LIMIT_SQL).get(serverId);
    expect(customLimit("host-1")).toEqual({ site_limit: 200 });
    expect(customLimit("hosted-1")).toEqual({ site_limit: 75 });

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
    expect(customLimit("host-1")).toEqual({ site_limit: 200 });

    // The rows stop with their account.
    insert.run("host-3", "other", 10);
    database.exec("DELETE FROM users WHERE id = 'other'");
    expect(database.prepare("SELECT server_id FROM server_site_limits ORDER BY server_id").all()).toEqual([
      { server_id: "host-1" },
      { server_id: "hosted-1" },
    ]);
    // The pool and account counts of a new site read only indexes. An unindexed count once overloaded
    // the production D1.
    for (const bucket of [
      { kind: "shared", serverId: "host-1", limit: 3 },
      { kind: "server", serverId: "host-1", limit: 3, custom: false },
      { kind: "unlinked", limit: 1 },
    ] as const) {
      const room = bucketHasRoomSql(bucket, "owner", null, 10);
      const plan = database
        .prepare(`EXPLAIN QUERY PLAN SELECT (${room.sql}) AS room`)
        .all(...room.binds)
        .map((row) => String(row.detail));
      expect(plan.filter((detail) => /^SCAN (?!CONSTANT ROW)/u.test(detail))).toEqual([]);
    }

    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });
});

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  hosts: database.prepare("SELECT * FROM remote_hosts ORDER BY host_id").all(),
  hosted: database.prepare("SELECT * FROM hosted_servers ORDER BY server_id").all(),
});
