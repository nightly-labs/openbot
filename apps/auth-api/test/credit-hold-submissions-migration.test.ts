import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const HOLD_COLUMNS =
  "job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, status, outcome, charged_tenths, provider_job_id, created_at, check_at, expires_at, settled_at";

describe("credit hold submissions migration", () => {
  it("keeps every hold and ledger entry, and adds an empty submission time", () => {
    const database = migratedDatabase("0065_credit_media.sql");
    databases.push(database);
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Ana Lopez', NULL, 1, 1);
      INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
      VALUES ('host-1', 'owner', 'Studio', 2, 2);
      INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at)
      VALUES ('purchase:cs_1', 'owner', NULL, 3000, 'purchase', 'owner', 'cs_1', 3),
             ('spend:job-2', 'owner', NULL, -5, 'spend', 'owner', 'job-2', 8);
      INSERT INTO credit_holds(job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, created_at, check_at, expires_at)
      VALUES ('job-1', NULL, 'host-1', NULL, 'seedance-2.5', 175, 4, 5, 6),
             ('job-2', 'owner', NULL, 'owner', 'nano-banana-pro', 5, 4, 5, 6),
             ('job-3', 'owner', NULL, 'owner', 'nano-banana-pro', 15, 4, 5, 6);
      UPDATE credit_holds SET provider_job_id = 'p-1' WHERE job_id = 'job-1';
      UPDATE credit_holds SET status = 'charged', outcome = 'completed', charged_tenths = 5, provider_job_id = 'p-2', settled_at = 8
       WHERE job_id = 'job-2';
      UPDATE credit_holds SET status = 'released', outcome = 'abandoned', settled_at = 9 WHERE job_id = 'job-3';
    `);
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0066_credit_hold_submissions.sql"));
    database.exec("COMMIT");

    expect(snapshot(database)).toEqual(before);
    expect(database.prepare("SELECT job_id, submitted_at FROM credit_holds ORDER BY job_id").all()).toEqual([
      { job_id: "job-1", submitted_at: null },
      { job_id: "job-2", submitted_at: null },
      { job_id: "job-3", submitted_at: null },
    ]);
    database.exec(`
      INSERT INTO credit_holds(job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, created_at, check_at, expires_at)
      VALUES ('job-4', 'owner', NULL, 'owner', 'seedance-2.5', 10, 10, 11, 12);
      UPDATE credit_holds SET submitted_at = COALESCE(submitted_at, 13) WHERE job_id = 'job-4';
      UPDATE credit_holds SET submitted_at = COALESCE(submitted_at, 14) WHERE job_id = 'job-4';
    `);
    expect(database.prepare("SELECT submitted_at FROM credit_holds WHERE job_id = 'job-4'").get()).toEqual({
      submitted_at: 13,
    });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("rolls back when the column already exists", () => {
    const database = migratedDatabase("0065_credit_media.sql");
    databases.push(database);
    database.exec("ALTER TABLE credit_holds ADD COLUMN submitted_at TEXT");
    database.exec("BEGIN");
    expect(() => database.exec(migration("0066_credit_hold_submissions.sql"))).toThrow();
    database.exec("ROLLBACK");
    expect(
      database.prepare("SELECT type FROM pragma_table_info('credit_holds') WHERE name = 'submitted_at'").all(),
    ).toEqual([{ type: "TEXT" }]);
  });
});

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  hosts: database.prepare("SELECT * FROM remote_hosts ORDER BY host_id").all(),
  ledger: database.prepare("SELECT * FROM credit_ledger ORDER BY entry_id").all(),
  holds: database.prepare(`SELECT ${HOLD_COLUMNS} FROM credit_holds ORDER BY job_id`).all(),
});
