import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const MIGRATION = "0054_billing_currency_brl.sql";

function beforeMigration(): DatabaseSync {
  const database = migratedDatabase("0053_operator_host_pool.sql");
  databases.push(database);
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
    VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Owner', NULL, 1, 1);
    INSERT INTO hosted_servers(
      server_id, owner_user_id, name, provider_sandbox_id, provider_template, size, pending_size, plan,
      billing_interval, currency, checkout_session_id, desired_state, observed_state, observed_error,
      provider_event_at, last_wake_reason, claim_token_hash, claim_expires_at, claim_redeemed_at, auth_session_id,
      last_active_at, lease_until, next_run_at, idempotency_key, created_at, updated_at, deleted_at,
      deletion_scheduled_at, deletion_subscription_id, lifecycle_token, lifecycle_lease_until, legacy_member_limits,
      start_requested_at, operator_host, retired_sandbox_id, plan_ended_at
    ) VALUES
      ('running', 'owner', 'Studio', 'sbx_1', 'tpl_1', 'small', 'default', 'starter', 'month', 'eur', 'cs_1',
       'running', 'running', NULL, 5, 'message', 'claim_1', 9, 8, 'auth_1', 5, 10, 11, 'key-1', 1, 5, NULL,
       NULL, NULL, 'life_1', 12, 1, 4, NULL, NULL, NULL),
      ('moved', 'owner', 'Lab', NULL, 'tpl_1', 'default', NULL, 'standard', 'year', 'pln', NULL, 'idle', 'stopped',
       NULL, 3, 'schedule', NULL, NULL, NULL, NULL, 3, NULL, NULL, 'key-2', 2, 3, NULL, NULL, NULL, NULL, NULL, 0,
       NULL, 'leaseweb:1', 'sbx_2', 7),
      ('ended', 'owner', 'Old', 'sbx_3', NULL, 'large', NULL, 'pro', 'month', 'usd', NULL, 'deleted', 'deleted',
       'plan_ended', 4, 'create', NULL, NULL, NULL, NULL, 4, NULL, NULL, 'key-3', 3, 4, 6, 5, 'sub_3', NULL, NULL,
       0, NULL, NULL, NULL, NULL);
    INSERT INTO billing_sales_checkouts(
      session_id, return_token_hash, user_id, server_id, plan, interval, currency, amount, return_url, created_at,
      expires_at, completed_at, expired_at, returned_at, subscription_id, updated_at
    ) VALUES
      ('cs_1', 'hash_1', 'owner', 'running', 'starter', 'month', 'eur', 2000, '/app?server=running', 1, 2, 3, NULL,
       4, 'sub_1', 4),
      ('cs_2', 'hash_2', 'owner', NULL, 'pro', 'year', 'pln', 48000, '/billing/return', 5, 6, NULL, 7, NULL, NULL, 7);
  `);
  return database;
}

const servers = (database: DatabaseSync) => database.prepare("SELECT * FROM hosted_servers ORDER BY server_id").all();
const checkouts = (database: DatabaseSync) =>
  database.prepare("SELECT * FROM billing_sales_checkouts ORDER BY session_id").all();
const indexes = (database: DatabaseSync) =>
  database
    .prepare(
      `SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL
       AND tbl_name IN ('hosted_servers', 'billing_sales_checkouts') ORDER BY name`,
    )
    .all();
const columns = (database: DatabaseSync, table: string) => database.prepare(`PRAGMA table_info(${table})`).all();

describe("BRL billing currency migration", () => {
  it("keeps every server and checkout, with the same columns and indexes", () => {
    const database = beforeMigration();
    const before = {
      servers: servers(database),
      checkouts: checkouts(database),
      indexes: indexes(database),
      serverColumns: columns(database, "hosted_servers"),
      checkoutColumns: columns(database, "billing_sales_checkouts"),
    };

    database.exec("BEGIN");
    database.exec(migration(MIGRATION));
    database.exec("COMMIT");

    expect(servers(database)).toEqual(before.servers);
    expect(checkouts(database)).toEqual(before.checkouts);
    expect(indexes(database)).toEqual(before.indexes);
    expect(columns(database, "hosted_servers")).toEqual(before.serverColumns);
    expect(columns(database, "billing_sales_checkouts")).toEqual(before.checkoutColumns);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("accepts BRL, keeps the other constraints, and accepts the writes of the Worker before the deploy", () => {
    const database = beforeMigration();
    database.exec(migration(MIGRATION));

    database.exec(`
      INSERT INTO hosted_servers(
        server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state, observed_state,
        idempotency_key, legacy_member_limits, created_at, updated_at
      ) VALUES ('brl', 'owner', 'Real', 'small', 'starter', 'month', 'brl', 'running', 'awaiting_payment',
        'key-4', 0, 6, 6);
      INSERT INTO hosted_servers(
        server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state, observed_state,
        idempotency_key, created_at, updated_at
      ) VALUES ('old-worker', 'owner', 'Old Worker', 'small', 'starter', 'month', 'eur', 'running',
        'awaiting_payment', 'key-5', 6, 6);
      INSERT INTO billing_sales_checkouts(
        session_id, return_token_hash, user_id, server_id, plan, interval, currency, amount, return_url,
        created_at, expires_at, updated_at
      ) VALUES ('cs_3', 'hash_3', 'owner', 'brl', 'starter', 'month', 'brl', 12000, '/app', 8, 9, 8);
    `);
    expect(
      database
        .prepare("SELECT currency, legacy_member_limits FROM hosted_servers WHERE server_id = 'old-worker'")
        .get(),
    ).toEqual({ currency: "eur", legacy_member_limits: 1 });

    expect(() =>
      database.exec(`
        INSERT INTO hosted_servers(
          server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state, observed_state,
          idempotency_key, created_at, updated_at
        ) VALUES ('gbp', 'owner', 'GBP', 'small', 'starter', 'month', 'gbp', 'running', 'awaiting_payment',
          'key-6', 6, 6)`),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      database.exec("UPDATE hosted_servers SET provider_sandbox_id = 'sbx_9' WHERE server_id = 'moved'"),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      database.exec("UPDATE hosted_servers SET operator_host = 'leaseweb:1' WHERE server_id = 'old-worker'"),
    ).toThrow(/UNIQUE constraint failed/u);
    expect(() =>
      database.exec(`
        INSERT INTO hosted_servers(
          server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state, observed_state,
          idempotency_key, created_at, updated_at
        ) VALUES ('again', 'owner', 'Again', 'small', 'starter', 'month', 'eur', 'running', 'awaiting_payment',
          'key-1', 6, 6)`),
    ).toThrow(/UNIQUE constraint failed/u);
    expect(() =>
      database.exec(`
        INSERT INTO billing_sales_checkouts(
          session_id, return_token_hash, user_id, plan, interval, currency, amount, return_url, created_at,
          expires_at, updated_at
        ) VALUES ('cs_4', 'hash_4', 'owner', 'starter', 'month', 'gbp', 1, '/app', 1, 2, 1)`),
    ).toThrow(/CHECK constraint failed/u);
  });

  it("still deletes the checkouts of a deleted account", () => {
    const database = beforeMigration();
    database.exec(migration(MIGRATION));
    database.exec("DELETE FROM hosted_servers; DELETE FROM users WHERE id = 'owner';");
    expect(checkouts(database)).toEqual([]);
  });
});
