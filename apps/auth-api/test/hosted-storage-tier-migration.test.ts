import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const MIGRATION = "0057_hosted_storage_tier.sql";

function beforeMigration(): DatabaseSync {
  const database = migratedDatabase("0056_host_appearance.sql");
  databases.push(database);
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
    VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Owner', NULL, 1, 1);
    INSERT INTO hosted_servers(
      server_id, owner_user_id, name, provider_sandbox_id, provider_template, size, pending_size, plan,
      billing_interval, currency, desired_state, observed_state, observed_error, operator_host, retired_sandbox_id,
      plan_ended_at, idempotency_key, created_at, updated_at
    ) VALUES
      ('boat', 'owner', 'Studio', 'sbx_1', 'tpl_1', 'small', 'default', 'starter', 'month', 'eur', 'running',
       'running', NULL, NULL, NULL, NULL, 'key-1', 1, 5),
      ('vps', 'owner', 'Lab', NULL, 'tpl_1', 'default', NULL, 'standard', 'year', 'brl', 'idle', 'stopped', NULL,
       'leaseweb:12728110', 'sbx_2', NULL, 'key-2', 2, 3),
      ('ended', 'owner', 'Old', NULL, NULL, 'large', NULL, 'pro', 'month', 'usd', 'stopped', 'stopped', 'plan_ended',
       'leaseweb:12728111', NULL, 4, 'key-3', 3, 4),
      ('gone', 'owner', 'Gone', NULL, NULL, 'large', NULL, 'pro', 'month', 'pln', 'deleted', 'deleted', NULL, NULL,
       NULL, NULL, 'key-4', 4, 4);
  `);
  return database;
}

const rows = (database: DatabaseSync) => database.prepare("SELECT * FROM hosted_servers ORDER BY server_id").all();

describe("hosted storage tier migration", () => {
  it("keeps every hosted server, each with the plan storage", () => {
    const database = beforeMigration();
    const before = rows(database);

    database.exec("BEGIN");
    database.exec(migration(MIGRATION));
    database.exec("COMMIT");

    expect(rows(database)).toEqual(before.map((row) => ({ ...row, storage_tier: 0 })));
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("accepts the writes of the Worker that runs before the deploy", () => {
    const database = beforeMigration();
    database.exec(migration(MIGRATION));
    // The deployed Worker does not name the column in its insert, its plan change or its delete.
    database.exec(`
      INSERT INTO hosted_servers(
        server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state, observed_state,
        idempotency_key, created_at, updated_at
      ) VALUES ('old-worker', 'owner', 'Old Worker', 'small', 'starter', 'month', 'eur', 'running',
        'awaiting_payment', 'key-5', 6, 6);
      UPDATE hosted_servers SET plan = 'pro', billing_interval = 'month', currency = 'brl', size = 'large', updated_at = 7
        WHERE server_id = 'vps';
      UPDATE hosted_servers SET desired_state = 'deleted', observed_state = 'deleted', updated_at = 8
        WHERE server_id = 'boat';
    `);
    expect(database.prepare("SELECT server_id, storage_tier FROM hosted_servers ORDER BY server_id").all()).toEqual([
      { server_id: "boat", storage_tier: 0 },
      { server_id: "ended", storage_tier: 0 },
      { server_id: "gone", storage_tier: 0 },
      { server_id: "old-worker", storage_tier: 0 },
      { server_id: "vps", storage_tier: 0 },
    ]);
  });

  it("stores tiers 0 to 2 and refuses another value", () => {
    const database = beforeMigration();
    database.exec(migration(MIGRATION));

    database.exec("UPDATE hosted_servers SET storage_tier = 2 WHERE server_id = 'vps'");
    database.exec("UPDATE hosted_servers SET storage_tier = 1 WHERE server_id = 'ended'");
    expect(database.prepare("SELECT server_id, storage_tier FROM hosted_servers ORDER BY server_id").all()).toEqual([
      { server_id: "boat", storage_tier: 0 },
      { server_id: "ended", storage_tier: 1 },
      { server_id: "gone", storage_tier: 0 },
      { server_id: "vps", storage_tier: 2 },
    ]);
    expect(() => database.exec("UPDATE hosted_servers SET storage_tier = 3 WHERE server_id = 'vps'")).toThrow(
      /CHECK constraint failed/u,
    );
    expect(() => database.exec("UPDATE hosted_servers SET storage_tier = NULL WHERE server_id = 'vps'")).toThrow(
      /NOT NULL constraint failed/u,
    );
  });
});
