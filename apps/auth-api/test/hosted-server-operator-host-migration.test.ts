import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const MIGRATION = "0052_hosted_server_operator_host.sql";

function beforeMigration(): DatabaseSync {
  const database = migratedDatabase("0051_feedback_daily_counts.sql");
  databases.push(database);
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
    VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Owner', NULL, 1, 1);
    INSERT INTO hosted_servers(
      server_id, owner_user_id, name, provider_sandbox_id, provider_template, size, plan, billing_interval, currency,
      desired_state, observed_state, observed_error, provider_event_at, last_wake_reason, last_active_at,
      start_requested_at, idempotency_key, created_at, updated_at
    ) VALUES
      ('running', 'owner', 'Studio', 'sbx_1', 'tpl_1', 'small', 'starter', 'month', 'eur', 'running', 'running', NULL,
       5, 'message', 5, NULL, 'key-1', 1, 5),
      ('idle', 'owner', 'Lab', 'sbx_2', 'tpl_1', 'default', 'standard', 'year', 'pln', 'idle', 'stopped', NULL, 3,
       'schedule', 3, NULL, 'key-2', 2, 3),
      ('ended', 'owner', 'Old', 'sbx_3', NULL, 'large', 'pro', 'month', 'usd', 'stopped', 'stopped', 'plan_ended', 4,
       'create', 4, NULL, 'key-3', 3, 4),
      ('paying', 'owner', 'New', NULL, NULL, 'large', 'pro', 'month', 'usd', 'running', 'awaiting_payment', NULL, NULL,
       NULL, NULL, NULL, 'key-4', 4, 4);
  `);
  return database;
}

const rows = (database: DatabaseSync) => database.prepare("SELECT * FROM hosted_servers ORDER BY server_id").all();
const MOVE = `UPDATE hosted_servers SET operator_host = ?, retired_sandbox_id = provider_sandbox_id,
  provider_sandbox_id = NULL WHERE server_id = ?`;

describe("hosted server operator host migration", () => {
  it("keeps every hosted server, and boat runs each one", () => {
    const database = beforeMigration();
    const before = rows(database);

    database.exec("BEGIN");
    database.exec(migration(MIGRATION));
    database.exec("COMMIT");

    expect(rows(database)).toEqual(before.map((row) => ({ ...row, operator_host: null, retired_sandbox_id: null })));
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("accepts the writes of the Worker that runs before the deploy", () => {
    const database = beforeMigration();
    database.exec(migration(MIGRATION));
    // The deployed Worker names neither column in its insert, its setup, its wake or its delete.
    database.exec(`
      INSERT INTO hosted_servers(
        server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state, observed_state,
        idempotency_key, created_at, updated_at
      ) VALUES ('old-worker', 'owner', 'Old Worker', 'small', 'starter', 'month', 'eur', 'running',
        'awaiting_payment', 'key-5', 6, 6);
      UPDATE hosted_servers SET provider_sandbox_id = 'sbx_5', observed_state = 'starting', updated_at = 7
        WHERE server_id = 'old-worker';
      UPDATE hosted_servers SET observed_state = 'waking', last_wake_reason = 'message', updated_at = 7
        WHERE server_id = 'idle';
      UPDATE hosted_servers SET desired_state = 'deleted', observed_state = 'deleted', updated_at = 8
        WHERE server_id = 'ended';
    `);
    expect(
      database
        .prepare("SELECT server_id, provider_sandbox_id, operator_host, retired_sandbox_id FROM hosted_servers")
        .all(),
    ).toEqual(
      expect.arrayContaining([
        { server_id: "old-worker", provider_sandbox_id: "sbx_5", operator_host: null, retired_sandbox_id: null },
        { server_id: "idle", provider_sandbox_id: "sbx_2", operator_host: null, retired_sandbox_id: null },
      ]),
    );
  });

  it("lets an operator move a server out of boat and back, with no sandbox while it is out", () => {
    const database = beforeMigration();
    database.exec(migration(MIGRATION));

    database.prepare(MOVE).run("leaseweb:12728110", "running");
    expect(
      database
        .prepare(
          "SELECT provider_sandbox_id, operator_host, retired_sandbox_id FROM hosted_servers WHERE server_id = 'running'",
        )
        .get(),
    ).toEqual({ provider_sandbox_id: null, operator_host: "leaseweb:12728110", retired_sandbox_id: "sbx_1" });

    // A row with a machine outside boat and a sandbox would have two servers with one identity.
    expect(() =>
      database.exec("UPDATE hosted_servers SET operator_host = 'leaseweb:12728111' WHERE server_id = 'idle'"),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      database.exec("UPDATE hosted_servers SET provider_sandbox_id = 'sbx_9' WHERE server_id = 'running'"),
    ).toThrow(/CHECK constraint failed/u);
    // One machine holds one server.
    expect(() => database.prepare(MOVE).run("leaseweb:12728110", "idle")).toThrow(/UNIQUE constraint failed/u);

    database.exec(`
      UPDATE hosted_servers SET provider_sandbox_id = retired_sandbox_id, retired_sandbox_id = NULL,
        operator_host = NULL WHERE server_id = 'running'
    `);
    database.prepare(MOVE).run("leaseweb:12728110", "idle");
    expect(
      database
        .prepare("SELECT server_id, provider_sandbox_id, operator_host FROM hosted_servers ORDER BY server_id")
        .all(),
    ).toEqual([
      { server_id: "ended", provider_sandbox_id: "sbx_3", operator_host: null },
      { server_id: "idle", provider_sandbox_id: null, operator_host: "leaseweb:12728110" },
      { server_id: "paying", provider_sandbox_id: null, operator_host: null },
      { server_id: "running", provider_sandbox_id: "sbx_1", operator_host: null },
    ]);
  });
});
