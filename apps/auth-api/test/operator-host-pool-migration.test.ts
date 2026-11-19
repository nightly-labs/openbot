import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const MIGRATION = "0053_operator_host_pool.sql";

function beforeMigration(): DatabaseSync {
  const database = migratedDatabase("0052_hosted_server_operator_host.sql");
  databases.push(database);
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
    VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Owner', NULL, 1, 1);
    INSERT INTO hosted_servers(
      server_id, owner_user_id, name, provider_sandbox_id, provider_template, operator_host, retired_sandbox_id, size,
      plan, billing_interval, currency, desired_state, observed_state, observed_error, provider_event_at,
      last_wake_reason, last_active_at, start_requested_at, idempotency_key, created_at, updated_at
    ) VALUES
      ('boat', 'owner', 'Studio', 'sbx_1', 'tpl_1', NULL, NULL, 'small', 'starter', 'month', 'eur', 'running',
       'running', NULL, 5, 'message', 5, NULL, 'key-1', 1, 5),
      ('moved', 'owner', 'Lab', NULL, 'tpl_1', 'leaseweb:12728110', 'sbx_2', 'default', 'standard', 'year', 'pln',
       'running', 'running', NULL, 3, 'schedule', 3, NULL, 'key-2', 2, 3),
      ('ended', 'owner', 'Old', NULL, NULL, 'leaseweb:12728111', 'sbx_3', 'large', 'pro', 'month', 'usd', 'stopped',
       'stopped', 'plan_ended', 4, 'create', 4, NULL, 'key-3', 3, 4),
      ('gone', 'owner', 'Gone', NULL, NULL, 'leaseweb:12728112', 'sbx_4', 'default', 'standard', 'month', 'eur',
       'deleted', 'deleted', NULL, 4, 'create', 4, NULL, 'key-4', 4, 9);
  `);
  return database;
}

const rows = (database: DatabaseSync) => database.prepare("SELECT * FROM hosted_servers ORDER BY server_id").all();

describe("operator host pool migration", () => {
  it("keeps every hosted server and its machine, with no plan end date", () => {
    const database = beforeMigration();
    const before = rows(database);

    database.exec("BEGIN");
    database.exec(migration(MIGRATION));
    database.exec("COMMIT");

    expect(rows(database)).toEqual(before.map((row) => ({ ...row, plan_ended_at: null })));
    expect(database.prepare("SELECT COUNT(*) AS count FROM operator_hosts").get()).toEqual({ count: 0 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("accepts the writes of the Worker that runs before the deploy", () => {
    const database = beforeMigration();
    database.exec(migration(MIGRATION));
    // The deployed Worker names no new column: its insert, its plan end, its renewal and its delete.
    database.exec(`
      INSERT INTO hosted_servers(
        server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state, observed_state,
        idempotency_key, created_at, updated_at
      ) VALUES ('old-worker', 'owner', 'Old Worker', 'small', 'starter', 'month', 'eur', 'running',
        'awaiting_payment', 'key-5', 6, 6);
      UPDATE hosted_servers SET desired_state = 'stopped', observed_error = 'plan_ended', updated_at = 7
        WHERE server_id = 'moved';
      UPDATE hosted_servers SET desired_state = 'running', observed_error = NULL, updated_at = 8
        WHERE server_id = 'moved';
      UPDATE hosted_servers SET desired_state = 'deleted', observed_state = 'deleted', updated_at = 9
        WHERE server_id = 'ended';
    `);
    expect(
      database.prepare("SELECT server_id, desired_state, plan_ended_at FROM hosted_servers ORDER BY server_id").all(),
    ).toEqual([
      { server_id: "boat", desired_state: "running", plan_ended_at: null },
      { server_id: "ended", desired_state: "deleted", plan_ended_at: null },
      { server_id: "gone", desired_state: "deleted", plan_ended_at: null },
      { server_id: "moved", desired_state: "running", plan_ended_at: null },
      { server_id: "old-worker", desired_state: "running", plan_ended_at: null },
    ]);
  });

  it("records a pool machine once, and refuses a value that the pool snapshot cannot send", () => {
    const database = beforeMigration();
    database.exec(migration(MIGRATION));
    const add = database.prepare(
      "INSERT INTO operator_hosts(host_id, location, product, added_at, removed_at) VALUES (?, ?, ?, ?, NULL)",
    );

    add.run("leaseweb:12728110", "AMS-01", "VPS02", 10);
    add.run("leaseweb:12728113", "SYD-12", "VPS03", 10);
    expect(() => add.run("leaseweb:12728110", "AMS-01", "VPS02", 11)).toThrow(/UNIQUE constraint failed/u);
    for (const [host, location, product] of [
      ["sbx_1", "AMS-01", "VPS02"],
      ["leaseweb:", "AMS-01", "VPS02"],
      ["leaseweb:1abc", "AMS-01", "VPS02"],
      ["leaseweb:12728114", "ams-01", "VPS02"],
      ["leaseweb:12728114", "AMS-01 <b>", "VPS02"],
      ["leaseweb:12728114", "AMS-01", "vps2"],
    ] as const) {
      expect(() => add.run(host, location, product, 12)).toThrow(/CHECK constraint failed/u);
    }
    // A machine leaves the pool and keeps its record.
    database.exec("UPDATE operator_hosts SET removed_at = 13 WHERE host_id = 'leaseweb:12728113'");
    expect(database.prepare("SELECT host_id, removed_at FROM operator_hosts ORDER BY host_id").all()).toEqual([
      { host_id: "leaseweb:12728110", removed_at: null },
      { host_id: "leaseweb:12728113", removed_at: 13 },
    ]);
  });
});
