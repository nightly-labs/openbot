import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const MIGRATION = "0061_hosted_server_archives.sql";
const SHA256 = "a".repeat(64);

function beforeMigration(): DatabaseSync {
  const database = migratedDatabase("0059_referrals.sql");
  databases.push(database);
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
    VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Owner', NULL, 1, 1);
    INSERT INTO hosted_servers(
      server_id, owner_user_id, name, provider_sandbox_id, provider_template, size, pending_size, plan,
      billing_interval, currency, desired_state, observed_state, observed_error, operator_host, retired_sandbox_id,
      plan_ended_at, idempotency_key, created_at, updated_at
    ) VALUES
      ('vps', 'owner', 'Lab', NULL, 'tpl_1', 'default', NULL, 'standard', 'year', 'eur', 'running', 'running', NULL,
       'leaseweb:12728110', NULL, NULL, 'key-1', 1, 2),
      ('ended', 'owner', 'Old', NULL, NULL, 'large', NULL, 'pro', 'month', 'usd', 'stopped', 'stopped', 'plan_ended',
       'leaseweb:12728111', NULL, 4, 'key-2', 3, 4);
  `);
  return database;
}

function insertArchive(
  database: DatabaseSync,
  values: { key: string; wrappedKey: string | null; deletedAt: number | null },
) {
  database
    .prepare(
      `INSERT INTO hosted_server_archives(
        object_key, server_id, region, bucket, version_id, size_bytes, sha256, wrapped_key, plan_ended_at,
        delete_after, created_at, deleted_at
      ) VALUES (?, 'ended', 'eu', 'openbot-pool-archive-eu', 'version-1', 1000, ?, ?, 4, 1209600004, 10, ?)`,
    )
    .run(values.key, SHA256, values.wrappedKey, values.deletedAt);
}

const serverRows = (database: DatabaseSync) =>
  database.prepare("SELECT * FROM hosted_servers ORDER BY server_id").all();

describe("hosted server archives migration", () => {
  it("keeps every hosted server and adds an empty archive table", () => {
    const database = beforeMigration();
    const before = serverRows(database);

    database.exec("BEGIN");
    database.exec(migration(MIGRATION));
    database.exec("COMMIT");

    expect(serverRows(database)).toEqual(before);
    expect(database.prepare("SELECT COUNT(*) AS count FROM hosted_server_archives").get()).toEqual({ count: 0 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("accepts the writes of the Worker that runs before the deploy", () => {
    const database = beforeMigration();
    database.exec(migration(MIGRATION));
    database.exec(`
      INSERT INTO hosted_servers(
        server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state, observed_state,
        idempotency_key, created_at, updated_at
      ) VALUES ('old-worker', 'owner', 'Old Worker', 'small', 'starter', 'month', 'eur', 'running',
        'awaiting_payment', 'key-3', 6, 6);
      UPDATE hosted_servers SET desired_state = 'stopped', observed_error = 'plan_ended', plan_ended_at = 7,
        updated_at = 7 WHERE server_id = 'vps';
    `);
    expect(database.prepare("SELECT server_id, plan_ended_at FROM hosted_servers ORDER BY server_id").all()).toEqual([
      { server_id: "ended", plan_ended_at: 4 },
      { server_id: "old-worker", plan_ended_at: null },
      { server_id: "vps", plan_ended_at: 7 },
    ]);
  });

  it("keeps the archive row with no link that a server or account delete can remove", () => {
    const database = beforeMigration();
    database.exec(migration(MIGRATION));
    insertArchive(database, { key: "eu/ended/1.age", wrappedKey: "v1.wrapped", deletedAt: null });

    database.exec("UPDATE hosted_servers SET desired_state = 'deleted', observed_state = 'deleted'");

    expect(database.prepare("PRAGMA foreign_key_list(hosted_server_archives)").all()).toEqual([]);
    expect(database.prepare("SELECT object_key, server_id FROM hosted_server_archives").all()).toEqual([
      { object_key: "eu/ended/1.age", server_id: "ended" },
    ]);
  });

  it("keeps a key only while the archive exists", () => {
    const database = beforeMigration();
    database.exec(migration(MIGRATION));
    insertArchive(database, { key: "eu/ended/1.age", wrappedKey: "v1.wrapped", deletedAt: null });

    expect(() =>
      database.exec("UPDATE hosted_server_archives SET deleted_at = 20 WHERE object_key = 'eu/ended/1.age'"),
    ).toThrow(/CHECK/u);
    database.exec(
      "UPDATE hosted_server_archives SET deleted_at = 20, wrapped_key = NULL WHERE object_key = 'eu/ended/1.age'",
    );
    expect(() => insertArchive(database, { key: "eu/ended/2.age", wrappedKey: null, deletedAt: null })).toThrow(
      /CHECK/u,
    );
    expect(() =>
      database
        .prepare(
          `INSERT INTO hosted_server_archives(
            object_key, server_id, region, bucket, version_id, size_bytes, sha256, wrapped_key, plan_ended_at,
            delete_after, created_at
          ) VALUES ('eu/ended/3.age', 'ended', 'eu', 'b', 'v', 1000, 'short', 'v1.wrapped', 4, 5, 10)`,
        )
        .run(),
    ).toThrow(/CHECK/u);
  });
});
