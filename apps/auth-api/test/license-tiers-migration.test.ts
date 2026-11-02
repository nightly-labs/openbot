import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("license tiers migration", () => {
  it("keeps rows, keeps the old member limits for old servers, and accepts old Worker writes", () => {
    const database = migratedDatabase("0040_server_member_limits.sql");
    databases.push(database);
    database.exec(`
      INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
      VALUES ('owner', 'email:owner@example.test', 'owner@example.test', 'Owner', NULL, 1, 1);
      INSERT INTO hosted_servers(
        server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state, observed_state,
        idempotency_key, created_at, updated_at
      ) VALUES ('server-1', 'owner', 'Studio', 'small', 'starter', 'month', 'eur', 'running', 'running', 'key-1', 1, 1);
      INSERT INTO billing_customers(user_id, stripe_customer_id, created_at, updated_at)
      VALUES ('owner', 'cus_1', 1, 1);
      INSERT INTO billing_subscriptions(
        stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, amount, status,
        current_period_end, cancel_at_period_end, updated_at
      ) VALUES ('sub_server', 'owner', 'cus_1', 'server-1', 'starter', 'month', 'eur', 2000, 'active', 10, 0, 1);
      INSERT INTO licenses(
        stripe_subscription_id, user_id, stripe_customer_id, users, currency, status, current_period_end,
        cancel_at_period_end, updated_at
      ) VALUES ('sub_license', 'owner', 'cus_1', 7, 'eur', 'active', 30, 0, 4);
    `);
    const before = snapshot(database);

    database.exec("BEGIN");
    database.exec(migration("0041_license_tiers.sql"));
    database.exec("COMMIT");

    const after = snapshot(database);
    expect(after.users).toEqual(before.users);
    expect(after.customers).toEqual(before.customers);
    expect(after.subscriptions).toEqual(before.subscriptions);
    expect(after.servers).toEqual(before.servers.map((row) => ({ ...row, legacy_member_limits: 1 })));
    expect(after.licenses).toEqual(
      before.licenses.map((row) => ({ ...row, tier: null, billing_interval: null, bundle: 0 })),
    );

    // The old Worker's writes name their columns, so they still run. Its new server keeps the old member limits.
    database.exec(`
      INSERT INTO hosted_servers(
        server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state, observed_state,
        idempotency_key, created_at, updated_at
      ) VALUES ('server-2', 'owner', 'Lab', 'small', 'starter', 'month', 'eur', 'running', 'awaiting_payment', 'key-2', 2, 2);
      INSERT INTO licenses(
        stripe_subscription_id, user_id, stripe_customer_id, users, currency, status, current_period_end,
        cancel_at_period_end, updated_at
      ) VALUES ('sub_license', 'owner', 'cus_1', 9, 'eur', 'active', 40, 1, 5)
      ON CONFLICT(stripe_subscription_id) DO UPDATE SET
        users = excluded.users, status = excluded.status, current_period_end = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end, updated_at = excluded.updated_at
      WHERE excluded.updated_at >= licenses.updated_at;
    `);
    expect(
      database.prepare("SELECT legacy_member_limits FROM hosted_servers WHERE server_id = 'server-2'").get(),
    ).toEqual({ legacy_member_limits: 1 });
    expect(
      database
        .prepare(
          "SELECT users, tier, billing_interval, bundle FROM licenses WHERE stripe_subscription_id = 'sub_license'",
        )
        .get(),
    ).toEqual({ users: 9, tier: null, billing_interval: null, bundle: 0 });

    // The new Worker's writes.
    database.exec(`
      INSERT INTO hosted_servers(
        server_id, owner_user_id, name, size, plan, billing_interval, currency, desired_state, observed_state,
        idempotency_key, legacy_member_limits, created_at, updated_at
      ) VALUES ('server-3', 'owner', 'New', 'small', 'starter', 'month', 'eur', 'running', 'awaiting_payment', 'key-3', 0, 3, 3);
      UPDATE licenses SET tier = 'starter', billing_interval = 'year', bundle = 1
      WHERE stripe_subscription_id = 'sub_license';
    `);
    expect(() => database.exec("UPDATE hosted_servers SET legacy_member_limits = 2")).toThrow();
    expect(() => database.exec("UPDATE licenses SET tier = 'gold'")).toThrow();
    expect(() => database.exec("UPDATE licenses SET tier = 'server'")).toThrow();
    expect(() => database.exec("UPDATE licenses SET bundle = 2")).toThrow();
    expect(() => database.exec("UPDATE licenses SET billing_interval = 'week'")).toThrow();
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });
});

const snapshot = (database: DatabaseSync) => ({
  users: database.prepare("SELECT * FROM users ORDER BY id").all(),
  servers: database.prepare("SELECT * FROM hosted_servers ORDER BY server_id").all(),
  customers: database.prepare("SELECT * FROM billing_customers ORDER BY user_id").all(),
  subscriptions: database.prepare("SELECT * FROM billing_subscriptions ORDER BY stripe_subscription_id").all(),
  licenses: database.prepare("SELECT * FROM licenses ORDER BY stripe_subscription_id").all(),
});
