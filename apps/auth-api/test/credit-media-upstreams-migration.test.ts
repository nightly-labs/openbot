import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const MODEL_COLUMNS =
  "model_id, upstream_id, kind, name, maker, variant, position, enabled, specs, upstream_params, updated_at";
const HOLD_COLUMNS =
  "job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, status, outcome, charged_tenths, provider_job_id, created_at, check_at, expires_at, settled_at, submitted_at";

describe("credit media upstreams migration", () => {
  it("keeps every model, price, hold and ledger entry, and puts them on the current upstream", () => {
    const database = migratedDatabase("0068_credit_activity.sql");
    databases.push(database);
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Ana Lopez', NULL, 1, 1);
      INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
      VALUES ('host-1', 'owner', 'Studio', 2, 2);
      INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at)
      VALUES ('purchase:cs_1', 'owner', NULL, 3000, 'purchase', 'owner', 'cs_1', 3),
             ('spend:job-2', 'owner', NULL, -5, 'spend', 'owner', 'job-2', 8);
      INSERT INTO credit_media_models(${MODEL_COLUMNS})
      VALUES ('seedance-2.5', 'up-video-1', 'video', 'Seedance 2.5', 'ByteDance', NULL, 1, 1, '{"durations":[5,10]}', '{}', 7),
             ('image-one', 'up-image-1', 'image', 'Image One', 'Maker', 'High', 2, 0, '{}', '{"quality":"high"}', 7);
      INSERT INTO credit_media_prices(model_id, resolution, unit, credits, silent_credits, updated_at)
      VALUES ('seedance-2.5', '720p', 'second', 7, 3.5, 7),
             ('image-one', '', 'item', 4.5, NULL, 7);
      INSERT INTO credit_holds(job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, created_at, check_at, expires_at)
      VALUES ('job-1', NULL, 'host-1', NULL, 'seedance-2.5', 175, 4, 5, 6),
             ('job-2', 'owner', NULL, 'owner', 'image-one', 5, 4, 5, 6),
             ('job-3', 'owner', NULL, 'owner', 'image-one', 15, 4, 5, 6);
      UPDATE credit_holds SET provider_job_id = 'p-1', submitted_at = 4 WHERE job_id = 'job-1';
      UPDATE credit_holds SET status = 'charged', outcome = 'completed', charged_tenths = 5, provider_job_id = 'p-2', settled_at = 8
       WHERE job_id = 'job-2';
      UPDATE credit_holds SET status = 'released', outcome = 'abandoned', settled_at = 9 WHERE job_id = 'job-3';
    `);
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0069_credit_media_upstreams.sql"));
    database.exec("COMMIT");

    expect(snapshot(database)).toEqual(before);
    expect(database.prepare("SELECT model_id, upstream FROM credit_media_models ORDER BY model_id").all()).toEqual([
      { model_id: "image-one", upstream: "router" },
      { model_id: "seedance-2.5", upstream: "router" },
    ]);
    expect(
      database
        .prepare(
          "SELECT job_id, upstream, upstream_model, upstream_params, submit_lease_until FROM credit_holds ORDER BY job_id",
        )
        .all(),
    ).toEqual(
      ["job-1", "job-2", "job-3"].map((job_id) => ({
        job_id,
        upstream: null,
        upstream_model: null,
        upstream_params: null,
        submit_lease_until: null,
      })),
    );

    database.exec(`
      INSERT INTO credit_media_models(${MODEL_COLUMNS})
      VALUES ('image-two', 'up-image-2', 'image', 'Image Two', 'Maker', NULL, 3, 0, '{}', '{}', 10)
      ON CONFLICT(model_id) DO UPDATE SET upstream_id = excluded.upstream_id, updated_at = excluded.updated_at;
      UPDATE credit_media_models SET upstream = 'tasks', upstream_id = 'other-image' WHERE model_id = 'image-one';
      INSERT INTO credit_media_models(${MODEL_COLUMNS})
      VALUES ('image-one', 'up-image-1', 'image', 'Image One', 'Maker', 'High', 2, 0, '{}', '{"quality":"high"}', 11)
      ON CONFLICT(model_id) DO UPDATE SET upstream_id = excluded.upstream_id, updated_at = excluded.updated_at;
      INSERT INTO credit_holds(job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, created_at, check_at, expires_at)
      VALUES ('job-4', 'owner', NULL, 'owner', 'image-one', 10, 10, 11, 12);
      UPDATE credit_holds SET provider_job_id = 'p-4' WHERE job_id = 'job-4' AND provider_job_id IS NULL;
      INSERT INTO credit_holds(job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, created_at, check_at, expires_at)
      VALUES ('job-5', 'owner', NULL, 'owner', 'image-one', 10, 10, 11, 12);
      UPDATE credit_holds SET submitted_at = 10, submit_lease_until = 190, upstream = COALESCE(upstream, 'tasks'),
             upstream_model = COALESCE(upstream_model, 'other-image'), upstream_params = COALESCE(upstream_params, '{}')
       WHERE job_id = 'job-5' AND status = 'held' AND provider_job_id IS NULL;
      UPDATE credit_holds SET provider_job_id = 'p-5', upstream = 'tasks', submit_lease_until = NULL
       WHERE job_id = 'job-5' AND provider_job_id IS NULL;
    `);
    expect(
      database.prepare("SELECT model_id, upstream, upstream_id FROM credit_media_models ORDER BY model_id").all(),
    ).toEqual([
      { model_id: "image-one", upstream: "tasks", upstream_id: "up-image-1" },
      { model_id: "image-two", upstream: "router", upstream_id: "up-image-2" },
      { model_id: "seedance-2.5", upstream: "router", upstream_id: "up-video-1" },
    ]);
    expect(
      database
        .prepare(
          `SELECT job_id, upstream, upstream_model, upstream_params, submit_lease_until FROM credit_holds
            WHERE job_id IN ('job-4', 'job-5') ORDER BY job_id`,
        )
        .all(),
    ).toEqual([
      { job_id: "job-4", upstream: null, upstream_model: null, upstream_params: null, submit_lease_until: null },
      {
        job_id: "job-5",
        upstream: "tasks",
        upstream_model: "other-image",
        upstream_params: "{}",
        submit_lease_until: null,
      },
    ]);
    for (const statement of [
      "UPDATE credit_media_models SET upstream = '' WHERE model_id = 'image-two'",
      "UPDATE credit_media_models SET upstream = NULL WHERE model_id = 'image-two'",
      `UPDATE credit_media_models SET upstream = '${"x".repeat(41)}' WHERE model_id = 'image-two'`,
    ])
      expect(() => database.exec(statement)).toThrow();
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("rolls back as one unit when a statement fails", () => {
    const database = migratedDatabase("0068_credit_activity.sql");
    databases.push(database);
    database.exec("ALTER TABLE credit_holds ADD COLUMN upstream INTEGER");
    database.exec("BEGIN");
    expect(() => database.exec(migration("0069_credit_media_upstreams.sql"))).toThrow();
    database.exec("ROLLBACK");
    expect(
      database.prepare("SELECT name FROM pragma_table_info('credit_media_models') WHERE name = 'upstream'").all(),
    ).toEqual([]);
    expect(
      database
        .prepare(
          "SELECT name, type FROM pragma_table_info('credit_holds') WHERE name IN ('upstream', 'upstream_model', 'upstream_params', 'submit_lease_until')",
        )
        .all(),
    ).toEqual([{ name: "upstream", type: "INTEGER" }]);
  });
});

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  hosts: database.prepare("SELECT * FROM remote_hosts ORDER BY host_id").all(),
  ledger: database.prepare("SELECT * FROM credit_ledger ORDER BY entry_id").all(),
  models: database.prepare(`SELECT ${MODEL_COLUMNS} FROM credit_media_models ORDER BY model_id`).all(),
  prices: database.prepare("SELECT * FROM credit_media_prices ORDER BY model_id, resolution").all(),
  holds: database.prepare(`SELECT ${HOLD_COLUMNS} FROM credit_holds ORDER BY job_id`).all(),
});
