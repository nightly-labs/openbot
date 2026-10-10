import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migratedDatabase, migration } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("sales analytics migration", () => {
  it("is additive and keeps the old Worker schema usable", () => {
    const database = migratedDatabase("0029_telegram_chat_routes.sql");
    databases.push(database);
    database.exec(
      `INSERT INTO users(id, identity_key, email, created_at, updated_at)
       VALUES ('user-1', 'email:one@example.test', 'one@example.test', 1, 1);
       INSERT INTO billing_customers(user_id, stripe_customer_id, created_at, updated_at)
       VALUES ('user-1', 'cus_1', 1, 1);
       INSERT INTO billing_subscriptions(
         stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, status,
         current_period_end, cancel_at_period_end, updated_at
       ) VALUES ('sub_1', 'user-1', 'cus_1', NULL, 'standard', 'month', 'usd', 'active', 100, 0, 1)`,
    );
    const before = {
      users: database.prepare("SELECT id, email, created_at FROM users").all(),
      customers: database.prepare("SELECT * FROM billing_customers").all(),
      subscriptions: database.prepare("SELECT * FROM billing_subscriptions").all(),
    };
    database.exec(migration("0030_sales_analytics.sql"));
    database.exec(
      `INSERT INTO users(id, identity_key, email, created_at, updated_at)
       VALUES ('user-2', 'email:two@example.test', 'two@example.test', 2, 2);
       INSERT INTO billing_customers(user_id, stripe_customer_id, created_at, updated_at)
       VALUES ('user-2', 'cus_2', 2, 2);
       INSERT INTO billing_subscriptions(
         stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, status,
         current_period_end, cancel_at_period_end, updated_at
       ) VALUES ('sub_2', 'user-2', 'cus_2', NULL, 'pro', 'year', 'eur', 'past_due', 200, 1, 2)`,
    );

    expect(database.prepare("SELECT id, email, created_at FROM users ORDER BY id").all()).toEqual([
      ...before.users,
      { id: "user-2", email: "two@example.test", created_at: 2 },
    ]);
    expect(database.prepare("SELECT * FROM billing_customers ORDER BY user_id").all()).toEqual([
      ...before.customers,
      { user_id: "user-2", stripe_customer_id: "cus_2", created_at: 2, updated_at: 2 },
    ]);
    expect(database.prepare("SELECT * FROM billing_subscriptions ORDER BY stripe_subscription_id").all()).toEqual([
      ...before.subscriptions,
      {
        stripe_subscription_id: "sub_2",
        user_id: "user-2",
        stripe_customer_id: "cus_2",
        server_id: null,
        plan: "pro",
        interval: "year",
        currency: "eur",
        amount: null,
        status: "past_due",
        current_period_end: 200,
        cancel_at_period_end: 1,
        updated_at: 2,
      },
    ]);
    expect(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'billing_%'").all(),
    ).toEqual(expect.arrayContaining([{ name: "billing_analytics_events" }, { name: "billing_fx_rates" }]));
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("rolls back all new tables when a later migration statement fails", () => {
    const database = migratedDatabase("0029_telegram_chat_routes.sql");
    databases.push(database);
    database.exec("BEGIN");
    expect(() =>
      database.exec(`${migration("0030_sales_analytics.sql")}\nCREATE TABLE billing_analytics_events (id TEXT);`),
    ).toThrow();
    database.exec("ROLLBACK");

    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('billing_analytics_events', 'billing_fx_rates')",
        )
        .all(),
    ).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });
});
