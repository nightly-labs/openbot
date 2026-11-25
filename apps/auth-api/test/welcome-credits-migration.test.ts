import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const GRANT_COLUMNS =
  "grant_id, user_id, server_id, credits_tenths, remaining_tenths, source, starts_at, expires_at, status, created_at";
const HOLD_COLUMNS =
  "job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, status, outcome, charged_tenths, provider_job_id, created_at, check_at, expires_at, settled_at, submitted_at, submit_lease_until, upstream, upstream_model, upstream_params, upstream_fields";

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  ledger: database.prepare("SELECT * FROM credit_ledger ORDER BY entry_id").all(),
  grants: database.prepare(`SELECT ${GRANT_COLUMNS} FROM credit_grants ORDER BY grant_id`).all(),
  holds: database.prepare(`SELECT ${HOLD_COLUMNS} FROM credit_holds ORDER BY job_id`).all(),
  models: database.prepare("SELECT * FROM credit_media_models ORDER BY model_id").all(),
  prices: database.prepare("SELECT * FROM credit_media_prices ORDER BY model_id, resolution").all(),
});

function seeded(): DatabaseSync {
  const database = migratedDatabase("0071_membership_hidden_at.sql");
  databases.push(database);
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
    VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Ana Lopez', NULL, 1, 1);
    INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
    VALUES ('host-1', 'owner', 'Studio', 1, 1);
    INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at)
    VALUES ('purchase:cs_1', 'owner', NULL, 3000, 'purchase', 'owner', 'cs_1', 3),
           ('transfer:host-1', NULL, 'host-1', 500, 'transfer', 'owner', 'host-1', 4),
           ('spend:job-2', 'owner', NULL, -5, 'spend', 'owner', 'job-2', 8);
    INSERT INTO credit_grants(${GRANT_COLUMNS})
    VALUES ('referral:owner', 'owner', NULL, 50, 20, 'referral', 1, 1000, 'active', 1),
           ('promo:host-1', NULL, 'host-1', 30, 0, 'promo', 1, 2, 'expired', 1);
    INSERT INTO credit_media_models(model_id, upstream_id, kind, name, maker, variant, position, enabled, specs, upstream_params, updated_at)
    VALUES ('image-one', 'up-image-1', 'image', 'Image One', 'Maker', NULL, 1, 1, '{}', '{}', 7);
    INSERT INTO credit_media_prices(model_id, resolution, unit, credits, silent_credits, updated_at)
    VALUES ('image-one', '', 'item', 1.5, NULL, 7);
    INSERT INTO credit_holds(job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, created_at, check_at, expires_at)
    VALUES ('job-1', 'owner', NULL, 'owner', 'image-one', 15, 4, 5, 6),
           ('job-2', 'owner', NULL, 'owner', 'image-one', 5, 4, 5, 6),
           ('job-3', NULL, 'host-1', NULL, 'image-one', 15, 4, 5, 6);
    UPDATE credit_holds SET provider_job_id = 'p-1', submitted_at = 4, upstream = 'router', upstream_model = 'up-image-1',
           upstream_params = '{}' WHERE job_id = 'job-1';
    UPDATE credit_holds SET status = 'charged', outcome = 'completed', charged_tenths = 5, provider_job_id = 'p-2', settled_at = 8
     WHERE job_id = 'job-2';
  `);
  return database;
}

describe("welcome credits migration", () => {
  it("keeps every grant and hold, gives old grants the all scope and old holds paid funding, and accepts welcome rows", () => {
    const database = seeded();
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0073_welcome_credits.sql"));
    database.exec("COMMIT");

    expect(snapshot(database)).toEqual(before);
    expect(database.prepare("SELECT grant_id, scope FROM credit_grants ORDER BY grant_id").all()).toEqual([
      { grant_id: "promo:host-1", scope: "all" },
      { grant_id: "referral:owner", scope: "all" },
    ]);
    expect(database.prepare("SELECT job_id, funding FROM credit_holds ORDER BY job_id").all()).toEqual(
      ["job-1", "job-2", "job-3"].map((job_id) => ({ job_id, funding: "paid" })),
    );

    database.exec(`
      INSERT INTO credit_grants(${GRANT_COLUMNS})
      VALUES ('referral:late', 'owner', NULL, 10, 10, 'referral', 1, 1000, 'active', 9);
      INSERT INTO credit_holds(job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, created_at, check_at, expires_at)
      VALUES ('job-4', 'owner', NULL, 'owner', 'image-one', 15, 9, 10, 11);
      INSERT INTO credit_grants(${GRANT_COLUMNS}, scope)
      VALUES ('welcome:owner', 'owner', NULL, 100, 100, 'welcome', 0, 253402300799999, 'active', 9, 'welcome');
      INSERT INTO credit_holds(job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, created_at, check_at, expires_at, funding)
      VALUES ('job-5', 'owner', NULL, 'owner', 'image-one', 15, 9, 10, 11, 'welcome');
    `);
    expect(
      database.prepare("SELECT grant_id, scope FROM credit_grants WHERE created_at = 9 ORDER BY grant_id").all(),
    ).toEqual([
      { grant_id: "referral:late", scope: "all" },
      { grant_id: "welcome:owner", scope: "welcome" },
    ]);
    expect(
      database
        .prepare("SELECT job_id, funding FROM credit_holds WHERE job_id IN ('job-4', 'job-5') ORDER BY job_id")
        .all(),
    ).toEqual([
      { job_id: "job-4", funding: "paid" },
      { job_id: "job-5", funding: "welcome" },
    ]);

    for (const statement of [
      "UPDATE credit_grants SET scope = 'other' WHERE grant_id = 'referral:owner'",
      "UPDATE credit_grants SET scope = NULL WHERE grant_id = 'referral:owner'",
      "UPDATE credit_holds SET funding = 'free' WHERE job_id = 'job-1'",
      "UPDATE credit_holds SET funding = NULL WHERE job_id = 'job-1'",
    ])
      expect(() => database.exec(statement)).toThrow();

    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("rolls back as one unit when a statement fails", () => {
    const database = seeded();
    database.exec("ALTER TABLE credit_holds ADD COLUMN funding INTEGER");
    database.exec("BEGIN");
    expect(() => database.exec(migration("0073_welcome_credits.sql"))).toThrow();
    database.exec("ROLLBACK");
    expect(database.prepare("SELECT name FROM pragma_table_info('credit_grants') WHERE name = 'scope'").all()).toEqual(
      [],
    );
    expect(
      database.prepare("SELECT name, type FROM pragma_table_info('credit_holds') WHERE name = 'funding'").all(),
    ).toEqual([{ name: "funding", type: "INTEGER" }]);
  });
});
