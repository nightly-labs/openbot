import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const MIGRATION = "0055_operator_host_assignment.sql";

function beforeMigration(): DatabaseSync {
  const database = migratedDatabase("0054_billing_currency_brl.sql");
  databases.push(database);
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
    VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Owner', NULL, 1, 1);
    INSERT INTO operator_hosts(host_id, location, product, added_at, removed_at) VALUES
      ('leaseweb:12728110', 'AMS-01', 'VPS02', 10, NULL),
      ('leaseweb:12728111', 'WDC-02', 'VPS03', 11, NULL),
      ('leaseweb:12728112', 'AMS-01', 'VPS01', 12, 20);
    INSERT INTO hosted_servers(
      server_id, owner_user_id, name, provider_sandbox_id, provider_template, operator_host, retired_sandbox_id, size,
      plan, billing_interval, currency, desired_state, observed_state, observed_error, provider_event_at,
      last_wake_reason, last_active_at, start_requested_at, idempotency_key, created_at, updated_at, plan_ended_at
    ) VALUES
      ('boat', 'owner', 'Studio', 'sbx_1', 'tpl_1', NULL, NULL, 'small', 'starter', 'month', 'eur', 'running',
       'running', NULL, 5, 'message', 5, NULL, 'key-1', 1, 5, NULL),
      ('moved', 'owner', 'Lab', NULL, 'tpl_1', 'leaseweb:12728110', 'sbx_2', 'default', 'standard', 'year', 'pln',
       'running', 'running', NULL, 3, 'schedule', 3, NULL, 'key-2', 2, 3, NULL),
      ('ended', 'owner', 'Old', NULL, NULL, 'leaseweb:12728111', 'sbx_3', 'large', 'pro', 'month', 'brl', 'stopped',
       'stopped', 'plan_ended', 4, 'create', 4, NULL, 'key-3', 3, 4, 4);
  `);
  return database;
}

const all = (database: DatabaseSync, table: string, key: string) =>
  database.prepare(`SELECT * FROM ${table} ORDER BY ${key}`).all();

describe("operator host assignment migration", () => {
  it("keeps every pool machine and every hosted server, and offers no machine", () => {
    const database = beforeMigration();
    const machines = all(database, "operator_hosts", "host_id");
    const servers = all(database, "hosted_servers", "server_id");

    database.exec("BEGIN");
    database.exec(migration(MIGRATION));
    database.exec("COMMIT");

    expect(all(database, "operator_hosts", "host_id")).toEqual(
      machines.map((row) => ({ ...row, assign_token_hash: null, seen_at: null })),
    );
    expect(all(database, "hosted_servers", "server_id")).toEqual(servers);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("accepts the writes of the pool script and the reads of the Worker that run before the deploy", () => {
    const database = beforeMigration();
    database.exec(migration(MIGRATION));
    // `leaseweb-pool.ts add` and `remove` of the release before: they name no new column.
    database.exec(`
      INSERT INTO operator_hosts(host_id, location, product, added_at, removed_at)
      VALUES ('leaseweb:12728112', 'AMS-01', 'VPS01', 30, NULL)
      ON CONFLICT(host_id) DO UPDATE SET location = excluded.location, product = excluded.product, removed_at = NULL;
      INSERT INTO operator_hosts(host_id, location, product, added_at, removed_at)
      VALUES ('leaseweb:12728113', 'AMS-01', 'VPS02', 31, NULL);
      UPDATE operator_hosts SET removed_at = 32 WHERE host_id = 'leaseweb:12728111' AND removed_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM hosted_servers WHERE operator_host = 'leaseweb:12728111');
    `);
    // The pool snapshot of the Worker before.
    expect(
      database
        .prepare(
          `SELECT p.host_id, p.removed_at, h.server_id FROM operator_hosts p
           LEFT JOIN hosted_servers h ON h.operator_host = p.host_id ORDER BY p.host_id`,
        )
        .all(),
    ).toEqual([
      { host_id: "leaseweb:12728110", removed_at: null, server_id: "moved" },
      { host_id: "leaseweb:12728111", removed_at: null, server_id: "ended" },
      { host_id: "leaseweb:12728112", removed_at: null, server_id: null },
      { host_id: "leaseweb:12728113", removed_at: null, server_id: null },
    ]);
  });

  it("records the token and the last request of a machine", () => {
    const database = beforeMigration();
    database.exec(migration(MIGRATION));
    database.exec(
      "UPDATE operator_hosts SET assign_token_hash = 'hash', seen_at = 40 WHERE host_id = 'leaseweb:12728110'",
    );
    expect(
      database.prepare("SELECT host_id, assign_token_hash, seen_at FROM operator_hosts ORDER BY host_id").all(),
    ).toEqual([
      { host_id: "leaseweb:12728110", assign_token_hash: "hash", seen_at: 40 },
      { host_id: "leaseweb:12728111", assign_token_hash: null, seen_at: null },
      { host_id: "leaseweb:12728112", assign_token_hash: null, seen_at: null },
    ]);
  });
});
