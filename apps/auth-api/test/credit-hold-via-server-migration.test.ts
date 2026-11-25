import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const HOLD_COLUMNS =
  "job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, status, outcome, charged_tenths, provider_job_id, created_at, check_at, expires_at, settled_at, submitted_at, submit_lease_until, upstream, upstream_model, upstream_params, upstream_fields, funding";

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  hosts: database.prepare("SELECT * FROM remote_hosts ORDER BY host_id").all(),
  ledger: database.prepare("SELECT * FROM credit_ledger ORDER BY entry_id").all(),
  grants: database.prepare("SELECT * FROM credit_grants ORDER BY grant_id").all(),
  holds: database.prepare(`SELECT ${HOLD_COLUMNS} FROM credit_holds ORDER BY job_id`).all(),
});

function seeded(): DatabaseSync {
  const database = migratedDatabase("0074_welcome_credits.sql");
  databases.push(database);
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
    VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Ana Lopez', NULL, 1, 1);
    INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
    VALUES ('host-1', 'owner', 'Studio', 1, 1);
    INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at)
    VALUES ('grant:welcome:owner', 'owner', NULL, 100, 'grant', NULL, 'welcome:owner', 2),
           ('transfer:host-1', NULL, 'host-1', 500, 'transfer', 'owner', 'host-1', 4),
           ('spend:job-2', 'owner', NULL, -15, 'spend', 'owner', 'job-2', 8);
    INSERT INTO credit_grants(grant_id, user_id, server_id, credits_tenths, remaining_tenths, source, scope, starts_at, expires_at, status, created_at)
    VALUES ('welcome:owner', 'owner', NULL, 100, 85, 'welcome', 'welcome', 2, 253402300799999, 'active', 2);
    INSERT INTO credit_holds(job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, created_at, check_at, expires_at, funding)
    VALUES ('job-1', NULL, 'host-1', NULL, 'image-one', 15, 4, 5, 6, 'paid'),
           ('job-2', 'owner', NULL, 'owner', 'image-one', 15, 4, 5, 6, 'welcome');
    UPDATE credit_holds SET status = 'charged', outcome = 'completed', charged_tenths = 15, provider_job_id = 'p-2',
           upstream = 'tasks', settled_at = 8 WHERE job_id = 'job-2';
  `);
  return database;
}

describe("credit hold via server migration", () => {
  it("keeps every hold, gives old holds no via server, and accepts a hold on the owner made for a server", () => {
    const database = seeded();
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0075_credit_hold_via_server.sql"));
    database.exec("COMMIT");

    expect(snapshot(database)).toEqual(before);
    expect(database.prepare("SELECT job_id, via_server_id FROM credit_holds ORDER BY job_id").all()).toEqual([
      { job_id: "job-1", via_server_id: null },
      { job_id: "job-2", via_server_id: null },
    ]);

    database.exec(`
      INSERT INTO credit_holds(job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, created_at, check_at, expires_at, funding)
      VALUES ('job-3', NULL, 'host-1', NULL, 'image-one', 15, 9, 10, 11, 'paid');
      INSERT INTO credit_holds(job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, created_at, check_at, expires_at, funding, via_server_id)
      VALUES ('job-4', 'owner', NULL, NULL, 'image-one', 15, 9, 10, 11, 'welcome', 'host-1');
    `);
    expect(
      database
        .prepare(
          "SELECT job_id, user_id, server_id, via_server_id FROM credit_holds WHERE created_at = 9 ORDER BY job_id",
        )
        .all(),
    ).toEqual([
      { job_id: "job-3", user_id: null, server_id: "host-1", via_server_id: null },
      { job_id: "job-4", user_id: "owner", server_id: null, via_server_id: "host-1" },
    ]);

    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("rolls back as one unit when a statement fails", () => {
    const database = seeded();
    database.exec("ALTER TABLE credit_holds ADD COLUMN via_server_id INTEGER");
    database.exec("BEGIN");
    expect(() => database.exec(migration("0075_credit_hold_via_server.sql"))).toThrow();
    database.exec("ROLLBACK");
    expect(
      database.prepare("SELECT name, type FROM pragma_table_info('credit_holds') WHERE name = 'via_server_id'").all(),
    ).toEqual([{ name: "via_server_id", type: "INTEGER" }]);
  });
});
