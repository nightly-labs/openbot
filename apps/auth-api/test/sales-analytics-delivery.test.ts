import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runApiEffect } from "../src/server/effect-runtime";
import { SalesAnalyticsDelivery } from "../src/server/sales-analytics-delivery";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("sales analytics delivery", () => {
  it("deduplicates a source key and sends a timestamped revenue event", async () => {
    const database = migratedDatabase("0030_sales_analytics.sql");
    databases.push(database);
    addUser(database, "user_123");
    const requests: unknown[] = [];
    const fetch = vi.fn(async (_input: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 202 });
    });
    const delivery = new SalesAnalyticsDelivery({
      database: sqliteD1(database),
      clientId: "client",
      clientSecret: "secret",
      fetch,
      now: () => 1_700_000_000_000,
    });

    const event = {
      __revenue: 1200,
      amount_usd: 1200,
      original_currency: "eur",
      fx_rate: 1.08,
      fx_date: "2026-10-08",
      payment_kind: "first_purchase",
    };
    await runApiEffect(delivery.enqueue("invoice:in_123", "user_123", "revenue", event, 1_700_000_000_000));
    await runApiEffect(delivery.enqueue("invoice:in_123", "user_123", "revenue", event, 1_700_000_000_000));

    await expect(runApiEffect(delivery.drain())).resolves.toMatchObject({ claimed: 1, sent: 1 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(requests[0]).toMatchObject({
      type: "track",
      payload: {
        name: "revenue",
        profileId: "user_123",
        properties: expect.objectContaining({
          __revenue: 1200,
          event_schema_version: 9,
          __timestamp: "2023-11-14T22:13:20.000Z",
        }),
      },
    });
    expect(database.prepare("SELECT status, attempts FROM billing_analytics_events").all()).toEqual([
      { status: "sent", attempts: 1 },
    ]);
  });

  it("keeps ambiguous transport failures uncertain and does not replay them", async () => {
    const database = migratedDatabase("0030_sales_analytics.sql");
    databases.push(database);
    const fetch = vi.fn(async () => {
      throw new Error("network failure");
    });
    const delivery = new SalesAnalyticsDelivery({
      database: sqliteD1(database),
      clientId: "client",
      clientSecret: "secret",
      fetch,
      now: () => 1_700_000_000_000,
    });
    await runApiEffect(delivery.enqueue("invoice:in_unknown", null, "revenue", { __revenue: 500 }, 1_700_000_000_000));

    await expect(runApiEffect(delivery.drain())).resolves.toMatchObject({ claimed: 1, uncertain: 1 });
    await expect(runApiEffect(delivery.drain())).resolves.toMatchObject({ claimed: 0 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(database.prepare("SELECT status FROM billing_analytics_events").all()).toEqual([{ status: "uncertain" }]);
  });

  it("retries an explicit rate limit only a bounded number of times", async () => {
    const database = migratedDatabase("0030_sales_analytics.sql");
    databases.push(database);
    addUser(database, "user_123");
    let now = 1_700_000_000_000;
    const fetch = vi.fn(async () => new Response(null, { status: 429 }));
    const delivery = new SalesAnalyticsDelivery({
      database: sqliteD1(database),
      clientId: "client",
      clientSecret: "secret",
      fetch,
      now: () => now,
    });
    await runApiEffect(delivery.enqueue("invoice:in_rate_limited", "user_123", "revenue", { __revenue: 500 }, now));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(runApiEffect(delivery.drain())).resolves.toMatchObject({ claimed: 1, rejected: 1 });
      now += 60_000;
    }
    await expect(runApiEffect(delivery.drain())).resolves.toMatchObject({ claimed: 0 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(database.prepare("SELECT status, attempts FROM billing_analytics_events").all()).toEqual([
      { status: "rejected", attempts: 3 },
    ]);
  });

  it("does not send while credentials are unavailable, and rejects unknown properties", async () => {
    const database = migratedDatabase("0030_sales_analytics.sql");
    databases.push(database);
    addUser(database, "user_123");
    const fetch = vi.fn(async () => new Response(null, { status: 202 }));
    const delivery = new SalesAnalyticsDelivery({
      database: sqliteD1(database),
      clientId: undefined,
      clientSecret: undefined,
      fetch,
      now: () => 1_700_000_000_000,
    });
    await runApiEffect(
      delivery.enqueue(
        "checkout:cs_123",
        "user_123",
        "billing_action",
        { action: "checkout_started" },
        1_700_000_000_000,
      ),
    );
    await expect(runApiEffect(delivery.drain())).resolves.toMatchObject({ claimed: 0, pending: 1 });
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      runApiEffect(
        delivery.enqueue(
          "checkout:cs_private",
          "user_123",
          "billing_action",
          { action: "checkout_started", stripe_id: "secret" },
          1_700_000_000_000,
        ),
      ),
    ).rejects.toMatchObject({ _tag: "SalesAnalyticsDeliveryError", code: "invalid_event" });
  });

  it("tombstones undelivered account events before deleting the profile", async () => {
    const database = migratedDatabase("0030_sales_analytics.sql");
    databases.push(database);
    addUser(database, "user_123");
    const fetch = vi.fn(async () => new Response(null, { status: 202 }));
    const delivery = new SalesAnalyticsDelivery({
      database: sqliteD1(database),
      clientId: "client",
      clientSecret: "secret",
      fetch,
      now: () => 1_700_000_000_000,
    });
    await runApiEffect(
      delivery.enqueue("invoice:in_deleted", "user_123", "revenue", { __revenue: 500 }, 1_700_000_000_000),
    );
    database.prepare("DELETE FROM users WHERE id = ?").run("user_123");

    await runApiEffect(delivery.drain());
    expect(fetch).not.toHaveBeenCalled();
    expect(database.prepare("SELECT profile_id, status, last_error FROM billing_analytics_events").all()).toEqual([
      { profile_id: null, status: "rejected", last_error: "profile_deleted" },
    ]);
  });
});

function addUser(database: DatabaseSync, id: string): void {
  database
    .prepare(
      `INSERT INTO users(id, identity_key, email, created_at, updated_at)
       VALUES (?, ?, ?, 1, 1)`,
    )
    .run(id, `email:${id}@example.test`, `${id}@example.test`);
}
