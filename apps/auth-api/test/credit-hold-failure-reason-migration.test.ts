import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const HOLD_COLUMNS =
  "job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, status, outcome, charged_tenths, provider_job_id, created_at, check_at, expires_at, settled_at, submitted_at, submit_lease_until, upstream, upstream_model, upstream_params, upstream_fields, funding, via_server_id";

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  hosts: database.prepare("SELECT * FROM remote_hosts ORDER BY host_id").all(),
  ledger: database.prepare("SELECT * FROM credit_ledger ORDER BY entry_id").all(),
  holds: database.prepare(`SELECT ${HOLD_COLUMNS} FROM credit_holds ORDER BY job_id`).all(),
});

function seeded(): DatabaseSync {
  const database = migratedDatabase("0077_watch_sessions.sql");
  databases.push(database);
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
    VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Ana Lopez', NULL, 1, 1);
    INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
    VALUES ('host-1', 'owner', 'Studio', 1, 1);
    INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at)
    VALUES ('transfer:host-1', NULL, 'host-1', 500, 'transfer', 'owner', 'host-1', 4),
           ('spend:job-2', 'owner', NULL, -15, 'spend', 'owner', 'job-2', 8);
    INSERT INTO credit_holds(job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, created_at, check_at, expires_at, funding, via_server_id)
    VALUES ('job-1', NULL, 'host-1', NULL, 'image-one', 15, 4, 5, 6, 'paid', NULL),
           ('job-2', 'owner', NULL, 'owner', 'image-one', 15, 4, 5, 6, 'welcome', 'host-1'),
           ('job-3', 'owner', NULL, 'owner', 'image-one', 15, 4, 5, 6, 'paid', NULL);
    UPDATE credit_holds SET status = 'charged', outcome = 'completed', charged_tenths = 15, provider_job_id = 'p-2',
           upstream = 'tasks', settled_at = 8 WHERE job_id = 'job-2';
    UPDATE credit_holds SET status = 'released', outcome = 'refused', provider_job_id = 'p-3',
           upstream = 'tasks', settled_at = 9 WHERE job_id = 'job-3';
  `);
  return database;
}

describe("credit hold failure reason migration", () => {
  it("keeps every hold, gives old holds no reason, and stores the reason of a new release", () => {
    const database = seeded();
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0078_credit_hold_failure_reason.sql"));
    database.exec("COMMIT");

    expect(snapshot(database)).toEqual(before);
    expect(database.prepare("SELECT job_id, failure_reason FROM credit_holds ORDER BY job_id").all()).toEqual([
      { job_id: "job-1", failure_reason: null },
      { job_id: "job-2", failure_reason: null },
      { job_id: "job-3", failure_reason: null },
    ]);

    database.exec(`
      UPDATE credit_holds SET status = 'released', outcome = 'refused', failure_reason = 'content_policy', settled_at = 10
      WHERE job_id = 'job-1';
    `);
    expect(
      database.prepare("SELECT status, outcome, failure_reason FROM credit_holds WHERE job_id = 'job-1'").get(),
    ).toEqual({ status: "released", outcome: "refused", failure_reason: "content_policy" });

    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("rolls back as one unit when a statement fails", () => {
    const database = seeded();
    database.exec("ALTER TABLE credit_holds ADD COLUMN failure_reason INTEGER");
    database.exec("BEGIN");
    expect(() => database.exec(migration("0078_credit_hold_failure_reason.sql"))).toThrow();
    database.exec("ROLLBACK");
    expect(
      database.prepare("SELECT name, type FROM pragma_table_info('credit_holds') WHERE name = 'failure_reason'").all(),
    ).toEqual([{ name: "failure_reason", type: "INTEGER" }]);
  });
});
