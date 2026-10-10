import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { captureBillingSnapshot } from "../src/server/billing-snapshots";
import { runApiEffect } from "../src/server/effect-runtime";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1";

const NOW = Date.UTC(2026, 9, 9, 12, 0);
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("billing snapshots", () => {
  it("summarizes current active and overdue subscriptions after discounts", async () => {
    const database = migratedDatabase("0031_billing_sales.sql");
    databases.push(database);
    seedOwners(database);
    database.exec("INSERT INTO billing_fx_rates(day, currency, usd_rate) VALUES ('2026-10-09', 'eur', 2)");
    database.exec(`
      INSERT INTO billing_subscriptions(
        stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, amount,
        status, current_period_end, cancel_at_period_end, updated_at
      ) VALUES
        ('sub_month', 'user-1', 'cus-1', 'server-1', 'starter', 'month', 'eur', 1000, 'active', 2, 0, 1),
        ('sub_year', 'user-2', 'cus-2', 'server-2', 'pro', 'year', 'usd', 12000, 'past_due', 2, 1, 1),
        ('sub_free', 'user-3', 'cus-3', 'server-3', 'starter', 'month', 'eur', 1000, 'active', 2, 0, 1);
    `);
    const subscriptions = new Map([
      [
        "sub_month",
        {
          id: "sub_month",
          status: "active",
          currency: "eur",
          cancel_at_period_end: false,
          items: {
            data: [
              {
                quantity: 1,
                price: {
                  currency: "eur",
                  unit_amount: 1000,
                  recurring: { interval: "month", interval_count: 1 },
                },
              },
            ],
          },
          discounts: [{ id: "discount_1", coupon: { percent_off: 25 } }],
        },
      ],
      [
        "sub_year",
        {
          id: "sub_year",
          status: "past_due",
          currency: "usd",
          cancel_at_period_end: true,
          items: {
            data: [
              {
                quantity: 1,
                price: {
                  currency: "usd",
                  unit_amount: 12000,
                  recurring: { interval: "year", interval_count: 1 },
                },
              },
            ],
          },
        },
      ],
      [
        "sub_free",
        {
          id: "sub_free",
          status: "active",
          currency: "eur",
          cancel_at_period_end: false,
          items: {
            data: [
              {
                quantity: 1,
                price: {
                  currency: "eur",
                  unit_amount: 1000,
                  recurring: { interval: "month", interval_count: 1 },
                },
              },
            ],
          },
          discounts: [{ id: "discount_free", coupon: { percent_off: 100 } }],
        },
      ],
    ]);
    const fetcher = async (input: string) => {
      const id = decodeURIComponent(new URL(input).pathname.split("/").at(-1) ?? "");
      const subscription = subscriptions.get(id);
      return subscription ? Response.json(subscription) : new Response(null, { status: 404 });
    };

    await expect(
      runApiEffect(
        captureBillingSnapshot(
          {
            DB: sqliteD1(database),
            STRIPE_SECRET_KEY: "sk_test",
            OPENPANEL_CLIENT_ID: "client",
            OPENPANEL_CLIENT_SECRET: "secret",
          },
          NOW,
          fetcher,
        ),
      ),
    ).resolves.toBeUndefined();

    const events = database
      .prepare(
        `SELECT source_key, event_name, event_timestamp,
                json_extract(properties_json, '$.snapshot_date') AS snapshot_date,
                json_extract(properties_json, '$.as_of') AS as_of,
                json_extract(properties_json, '$.reported_at') AS reported_at,
                json_extract(properties_json, '$.currency') AS currency,
                json_extract(properties_json, '$.mrr') AS mrr,
                json_extract(properties_json, '$.arr') AS arr,
                json_extract(properties_json, '$.overdue_mrr') AS overdue_mrr,
                json_extract(properties_json, '$.paying_accounts') AS paying_accounts,
                json_extract(properties_json, '$.paid_servers') AS paid_servers,
                json_extract(properties_json, '$.cancellations_scheduled') AS cancellations_scheduled,
                json_extract(properties_json, '$.checkout_mature_accounts') AS checkout_mature_accounts,
                json_extract(properties_json, '$.checkout_converted_accounts') AS checkout_converted_accounts,
                json_extract(properties_json, '$.checkout_pending_accounts') AS checkout_pending_accounts
           FROM billing_analytics_events`,
      )
      .all();
    expect(events).toEqual([
      {
        source_key: "billing_snapshot:2026-10-09",
        event_name: "billing_snapshot",
        event_timestamp: NOW,
        snapshot_date: "2026-10-09",
        as_of: NOW,
        reported_at: NOW,
        currency: "usd",
        mrr: 2500,
        arr: 30000,
        overdue_mrr: 1000,
        paying_accounts: 2,
        paid_servers: 2,
        cancellations_scheduled: 1,
        checkout_mature_accounts: 0,
        checkout_converted_accounts: 0,
        checkout_pending_accounts: 0,
      },
    ]);
  });

  it("fails the whole sample when an included subscription has no fixed price", async () => {
    const database = migratedDatabase("0031_billing_sales.sql");
    databases.push(database);
    seedOwners(database);
    database.exec(`
      INSERT INTO billing_subscriptions(
        stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, amount,
        status, current_period_end, cancel_at_period_end, updated_at
      ) VALUES ('sub_missing_price', 'user-1', 'cus-1', 'server-1', 'starter', 'month', 'eur', NULL, 'active', 2, 0, 1);
    `);
    const fetcher = async () =>
      Response.json({
        id: "sub_missing_price",
        status: "active",
        currency: "eur",
        cancel_at_period_end: false,
        items: { data: [{ quantity: 1, price: { currency: "eur", unit_amount: null } }] },
      });

    await expect(
      runApiEffect(
        captureBillingSnapshot(
          {
            DB: sqliteD1(database),
            STRIPE_SECRET_KEY: "sk_test",
            OPENPANEL_CLIENT_ID: "client",
            OPENPANEL_CLIENT_SECRET: "secret",
          },
          NOW,
          fetcher,
        ),
      ),
    ).rejects.toMatchObject({ _tag: "BillingSnapshotError", code: "invalid_subscription" });
    expect(database.prepare("SELECT source_key FROM billing_analytics_events").all()).toEqual([]);
  });

  it("does not read Stripe again after the daily source key is already durable", async () => {
    const database = migratedDatabase("0031_billing_sales.sql");
    databases.push(database);
    database
      .prepare(
        `INSERT INTO billing_analytics_events(
           source_key, profile_id, event_name, properties_json, event_timestamp, created_at, updated_at
         ) VALUES (?, NULL, 'billing_snapshot', '{}', ?, ?, ?)`,
      )
      .run("billing_snapshot:2026-10-09", NOW, NOW, NOW);
    let stripeReads = 0;
    const fetcher = async () => {
      stripeReads += 1;
      return new Response(null, { status: 500 });
    };

    await expect(
      runApiEffect(
        captureBillingSnapshot(
          {
            DB: sqliteD1(database),
            STRIPE_SECRET_KEY: "sk_test",
            OPENPANEL_CLIENT_ID: "client",
            OPENPANEL_CLIENT_SECRET: "secret",
          },
          NOW,
          fetcher,
        ),
      ),
    ).resolves.toBeUndefined();
    expect(stripeReads).toBe(0);
    expect(database.prepare("SELECT source_key FROM billing_analytics_events").all()).toEqual([
      { source_key: "billing_snapshot:2026-10-09" },
    ]);
  });
});

function seedOwners(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
    VALUES ('user-1', 'email:user-1@example.test', 'user-1@example.test', 'User One', NULL, 1, 1),
           ('user-2', 'email:user-2@example.test', 'user-2@example.test', 'User Two', NULL, 1, 1),
           ('user-3', 'email:user-3@example.test', 'user-3@example.test', 'User Three', NULL, 1, 1);
    INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
    VALUES ('server-1', 'user-1', 'Server One', 1, 1),
           ('server-2', 'user-2', 'Server Two', 1, 1),
           ('server-3', 'user-3', 'Server Three', 1, 1);
  `);
}
