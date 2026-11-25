import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const MODEL_COLUMNS =
  "model_id, upstream, upstream_id, kind, name, maker, variant, position, enabled, specs, upstream_params, updated_at";
const HOLD_COLUMNS =
  "job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, status, outcome, charged_tenths, provider_job_id, created_at, check_at, expires_at, settled_at, submitted_at, submit_lease_until, upstream, upstream_model, upstream_params";
const ACTIVE_ROUTES = `SELECT m.model_id, r.upstream, r.upstream_id, r.upstream_params, r.upstream_fields
  FROM credit_media_models m
  LEFT JOIN credit_media_routes r ON r.model_id = m.model_id
   AND r.upstream = COALESCE((SELECT upstream FROM credit_media_settings WHERE id = 1), 'router')
 ORDER BY m.model_id`;

describe("credit media routes migration", () => {
  it("keeps every model, price and hold, gives each model a route on its upstream, and keeps the router active", () => {
    const database = migratedDatabase("0069_credit_media_upstreams.sql");
    databases.push(database);
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Ana Lopez', NULL, 1, 1);
      INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at)
      VALUES ('purchase:cs_1', 'owner', NULL, 3000, 'purchase', 'owner', 'cs_1', 3),
             ('spend:job-2', 'owner', NULL, -5, 'spend', 'owner', 'job-2', 8);
      INSERT INTO credit_media_models(${MODEL_COLUMNS})
      VALUES ('seedance-2.5', 'router', 'up-video-1', 'video', 'Seedance 2.5', 'ByteDance', NULL, 1, 1, '{"durations":[5,10]}', '{}', 7),
             ('image-one', 'router', 'up-image-1', 'image', 'Image One', 'Maker', 'High', 2, 0, '{}', '{"quality":"high"}', 7),
             ('image-two', 'tasks', 'other-image', 'image', 'Image Two', 'Maker', NULL, 3, 1, '{}', '{}', 9);
      INSERT INTO credit_media_prices(model_id, resolution, unit, credits, silent_credits, updated_at)
      VALUES ('seedance-2.5', '720p', 'second', 7, 3.5, 7),
             ('image-one', '', 'item', 4.5, NULL, 7),
             ('image-two', '', 'item', 2, NULL, 9);
      INSERT INTO credit_holds(job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, created_at, check_at, expires_at)
      VALUES ('job-1', 'owner', NULL, 'owner', 'seedance-2.5', 175, 4, 5, 6),
             ('job-2', 'owner', NULL, 'owner', 'image-one', 5, 4, 5, 6),
             ('job-3', 'owner', NULL, 'owner', 'image-two', 15, 4, 5, 6);
      UPDATE credit_holds SET provider_job_id = 'p-1', submitted_at = 4, upstream = 'router', upstream_model = 'up-video-1',
             upstream_params = '{}' WHERE job_id = 'job-1';
      UPDATE credit_holds SET status = 'charged', outcome = 'completed', charged_tenths = 5, provider_job_id = 'p-2', settled_at = 8
       WHERE job_id = 'job-2';
      UPDATE credit_holds SET submitted_at = 4, submit_lease_until = 200, upstream = 'tasks', upstream_model = 'other-image',
             upstream_params = '{}' WHERE job_id = 'job-3';
    `);
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0070_credit_media_routes.sql"));
    database.exec("COMMIT");

    expect(snapshot(database)).toEqual(before);
    expect(
      database
        .prepare(
          "SELECT model_id, upstream, upstream_id, upstream_params, upstream_fields, specs, updated_at FROM credit_media_routes ORDER BY model_id",
        )
        .all(),
    ).toEqual([
      {
        model_id: "image-one",
        upstream: "router",
        upstream_id: "up-image-1",
        upstream_params: '{"quality":"high"}',
        upstream_fields: "{}",
        specs: "{}",
        updated_at: 7,
      },
      {
        model_id: "image-two",
        upstream: "tasks",
        upstream_id: "other-image",
        upstream_params: "{}",
        upstream_fields: "{}",
        specs: "{}",
        updated_at: 9,
      },
      {
        model_id: "seedance-2.5",
        upstream: "router",
        upstream_id: "up-video-1",
        upstream_params: "{}",
        upstream_fields: "{}",
        specs: "{}",
        updated_at: 7,
      },
    ]);
    expect(database.prepare("SELECT id, upstream FROM credit_media_settings").all()).toEqual([
      { id: 1, upstream: "router" },
    ]);
    expect(database.prepare("SELECT job_id, upstream_fields FROM credit_holds ORDER BY job_id").all()).toEqual(
      ["job-1", "job-2", "job-3"].map((job_id) => ({ job_id, upstream_fields: null })),
    );
    expect(database.prepare(ACTIVE_ROUTES).all()).toEqual([
      {
        model_id: "image-one",
        upstream: "router",
        upstream_id: "up-image-1",
        upstream_params: '{"quality":"high"}',
        upstream_fields: "{}",
      },
      { model_id: "image-two", upstream: null, upstream_id: null, upstream_params: null, upstream_fields: null },
      {
        model_id: "seedance-2.5",
        upstream: "router",
        upstream_id: "up-video-1",
        upstream_params: "{}",
        upstream_fields: "{}",
      },
    ]);

    database.exec(`
      INSERT INTO credit_media_models(model_id, upstream_id, kind, name, maker, variant, position, enabled, specs, upstream_params, updated_at)
      VALUES ('image-three', 'up-image-3', 'image', 'Image Three', 'Maker', NULL, 4, 0, '{}', '{}', 10)
      ON CONFLICT(model_id) DO UPDATE SET upstream_id = excluded.upstream_id, updated_at = excluded.updated_at;
      UPDATE credit_media_models SET upstream = 'tasks', upstream_id = 'switched' WHERE model_id = 'image-one';
      INSERT INTO credit_holds(job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, created_at, check_at, expires_at)
      VALUES ('job-4', 'owner', NULL, 'owner', 'image-one', 10, 10, 11, 12);
      UPDATE credit_holds SET submitted_at = 10, submit_lease_until = 190, upstream = COALESCE(upstream, 'tasks'),
             upstream_model = COALESCE(upstream_model, 'switched'), upstream_params = COALESCE(upstream_params, '{}')
       WHERE job_id = 'job-4' AND status = 'held' AND provider_job_id IS NULL;
      UPDATE credit_holds SET provider_job_id = 'p-4', upstream = 'tasks', submit_lease_until = NULL
       WHERE job_id = 'job-4' AND provider_job_id IS NULL;
    `);
    expect(
      database.prepare("SELECT model_id, upstream, upstream_id FROM credit_media_models ORDER BY model_id").all(),
    ).toEqual([
      { model_id: "image-one", upstream: "tasks", upstream_id: "switched" },
      { model_id: "image-three", upstream: "router", upstream_id: "up-image-3" },
      { model_id: "image-two", upstream: "tasks", upstream_id: "other-image" },
      { model_id: "seedance-2.5", upstream: "router", upstream_id: "up-video-1" },
    ]);
    expect(
      database
        .prepare(
          "SELECT upstream, upstream_model, upstream_params, upstream_fields, provider_job_id FROM credit_holds WHERE job_id = 'job-4'",
        )
        .get(),
    ).toEqual({
      upstream: "tasks",
      upstream_model: "switched",
      upstream_params: "{}",
      upstream_fields: null,
      provider_job_id: "p-4",
    });

    database.exec(`
      INSERT INTO credit_media_routes(model_id, upstream, upstream_id, upstream_fields, updated_at)
      VALUES ('image-one', 'tasks', 'gpt-image-2', '{"size":{"name":"aspect_ratio"}}', 11),
             ('seedance-2.5', 'tasks', 'seedance-2.5', '{}', 11);
      UPDATE credit_media_settings SET upstream = 'tasks', updated_at = 12 WHERE id = 1;
      INSERT INTO credit_holds(job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, created_at, check_at, expires_at)
      VALUES ('job-5', 'owner', NULL, 'owner', 'image-one', 10, 12, 13, 14);
      UPDATE credit_holds SET submitted_at = 12, submit_lease_until = 190, upstream = COALESCE(upstream, 'tasks'),
             upstream_model = COALESCE(upstream_model, 'gpt-image-2'), upstream_params = COALESCE(upstream_params, '{}'),
             upstream_fields = CASE WHEN upstream IS NULL THEN '{"size":{"name":"aspect_ratio"}}' ELSE upstream_fields END
       WHERE job_id = 'job-5' AND status = 'held' AND provider_job_id IS NULL;
    `);
    expect(
      database
        .prepare(ACTIVE_ROUTES)
        .all()
        .map((row) => [row.model_id, row.upstream_id]),
    ).toEqual([
      ["image-one", "gpt-image-2"],
      ["image-three", null],
      ["image-two", "other-image"],
      ["seedance-2.5", "seedance-2.5"],
    ]);
    expect(
      database
        .prepare("SELECT upstream, upstream_model, upstream_fields FROM credit_holds WHERE job_id = 'job-5'")
        .get(),
    ).toEqual({
      upstream: "tasks",
      upstream_model: "gpt-image-2",
      upstream_fields: '{"size":{"name":"aspect_ratio"}}',
    });

    for (const statement of [
      "INSERT INTO credit_media_routes(model_id, upstream, upstream_id, updated_at) VALUES ('image-one', 'tasks', 'x', 1)",
      "INSERT INTO credit_media_routes(model_id, upstream, upstream_id, updated_at) VALUES ('missing', 'tasks', 'x', 1)",
      "INSERT INTO credit_media_routes(model_id, upstream, upstream_id, updated_at) VALUES ('image-three', '', 'x', 1)",
      `INSERT INTO credit_media_routes(model_id, upstream, upstream_id, updated_at) VALUES ('image-three', '${"x".repeat(41)}', 'x', 1)`,
      "INSERT INTO credit_media_routes(model_id, upstream, upstream_id, updated_at) VALUES ('image-three', 'tasks', '', 1)",
      "INSERT INTO credit_media_routes(model_id, upstream, upstream_id, upstream_params, updated_at) VALUES ('image-three', 'tasks', 'x', 'not json', 1)",
      "INSERT INTO credit_media_routes(model_id, upstream, upstream_id, upstream_fields, updated_at) VALUES ('image-three', 'tasks', 'x', '{', 1)",
      "INSERT INTO credit_media_routes(model_id, upstream, upstream_id, specs, updated_at) VALUES ('image-three', 'tasks', 'x', '[', 1)",
      "INSERT INTO credit_media_settings(id, upstream, updated_at) VALUES (2, 'router', 1)",
      "UPDATE credit_media_settings SET upstream = '' WHERE id = 1",
    ])
      expect(() => database.exec(statement)).toThrow();

    database.exec("DELETE FROM credit_media_prices WHERE model_id = 'image-three'");
    database.exec("DELETE FROM credit_media_models WHERE model_id = 'image-three'");
    database.exec("UPDATE credit_media_models SET model_id = 'seedance-2-5' WHERE model_id = 'seedance-2.5'");
    expect(
      database.prepare("SELECT model_id, upstream FROM credit_media_routes ORDER BY model_id, upstream").all(),
    ).toEqual([
      { model_id: "image-one", upstream: "router" },
      { model_id: "image-one", upstream: "tasks" },
      { model_id: "image-two", upstream: "tasks" },
      { model_id: "seedance-2-5", upstream: "router" },
      { model_id: "seedance-2-5", upstream: "tasks" },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("rolls back as one unit when a statement fails", () => {
    const database = migratedDatabase("0069_credit_media_upstreams.sql");
    databases.push(database);
    database.exec("ALTER TABLE credit_holds ADD COLUMN upstream_fields INTEGER");
    database.exec("BEGIN");
    expect(() => database.exec(migration("0070_credit_media_routes.sql"))).toThrow();
    database.exec("ROLLBACK");
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('credit_media_routes', 'credit_media_settings')",
        )
        .all(),
    ).toEqual([]);
    expect(
      database.prepare("SELECT name, type FROM pragma_table_info('credit_holds') WHERE name = 'upstream_fields'").all(),
    ).toEqual([{ name: "upstream_fields", type: "INTEGER" }]);
  });
});

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  ledger: database.prepare("SELECT * FROM credit_ledger ORDER BY entry_id").all(),
  models: database.prepare(`SELECT ${MODEL_COLUMNS} FROM credit_media_models ORDER BY model_id`).all(),
  prices: database.prepare("SELECT * FROM credit_media_prices ORDER BY model_id, resolution").all(),
  holds: database.prepare(`SELECT ${HOLD_COLUMNS} FROM credit_holds ORDER BY job_id`).all(),
});
