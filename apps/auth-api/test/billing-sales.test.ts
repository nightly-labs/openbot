import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { BillingSales } from "../src/server/billing-sales";
import { runApiEffect } from "../src/server/effect-runtime";
import type { StripeEvent } from "../src/server/stripe-client";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const checkout = {
  sessionId: "cs_test_sales_1",
  returnToken: "550e8400-e29b-41d4-a716-446655440000",
  userId: "sales-user",
  serverId: "server-1",
  plan: "standard" as const,
  interval: "month" as const,
  currency: "eur" as const,
  amount: 1200,
  returnUrl: "/app?hosting=checkout&cancelled=1",
  createdAt: 1_700_000_000_000,
};

function service(database: DatabaseSync): BillingSales {
  return new BillingSales({
    database: sqliteD1(database),
    clientId: undefined,
    clientSecret: undefined,
    fetch: async () => new Response(null, { status: 202 }),
    now: () => 1_700_000_100_000,
  });
}

function event(type: string, id: string, created: number, object: StripeEvent["data"]["object"]): StripeEvent {
  return { id, type, created, data: { object } };
}

describe("billing sales", () => {
  it("stores a checkout and records one return without exposing account data", async () => {
    const database = migratedDatabase("0031_billing_sales.sql");
    databases.push(database);
    database.exec(
      `INSERT INTO users(id, identity_key, email, created_at, updated_at)
       VALUES ('sales-user', 'email:sales@example.test', 'sales@example.test', 1, 1)`,
    );
    const sales = service(database);

    await runApiEffect(sales.checkout(checkout));
    await expect(runApiEffect(sales.returned(checkout.returnToken))).resolves.toBe(checkout.returnUrl);
    await expect(runApiEffect(sales.returned(checkout.returnToken))).resolves.toBe(checkout.returnUrl);

    expect(database.prepare("SELECT session_id, return_url FROM billing_sales_checkouts").all()).toEqual([
      { session_id: checkout.sessionId, return_url: checkout.returnUrl },
    ]);
    expect(database.prepare("SELECT fact_type FROM billing_sales_facts ORDER BY fact_type").all()).toEqual([
      { fact_type: "checkout_returned" },
      { fact_type: "checkout_started" },
    ]);
  });

  it("deduplicates paid invoices and derives recovery from an earlier failure", async () => {
    const database = migratedDatabase("0031_billing_sales.sql");
    databases.push(database);
    database.exec(
      `INSERT INTO users(id, identity_key, email, created_at, updated_at)
       VALUES ('sales-user', 'email:sales@example.test', 'sales@example.test', 1, 1);
       INSERT INTO billing_subscriptions(
         stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, amount,
         status, current_period_end, cancel_at_period_end, updated_at
       ) VALUES ('sub_sales', 'sales-user', 'cus_sales', 'server-1', 'standard', 'month', 'eur', 1200,
         'active', 1, 0, 1);`,
    );
    const sales = service(database);
    const failed = event("invoice.payment_failed", "evt_failed", 1_700_000_010, {
      id: "in_sales",
      subscription: "sub_sales",
      amount_due: 1200,
      currency: "eur",
      billing_reason: "subscription_cycle",
      attempt_count: 1,
    });
    const paid = event("invoice.paid", "evt_paid", 1_700_000_020, {
      id: "in_sales",
      subscription: "sub_sales",
      amount_paid: 1200,
      currency: "eur",
      billing_reason: "subscription_cycle",
    });

    await runApiEffect(
      sales.webhook(failed, { userId: "sales-user", plan: "standard", interval: "month", currency: "eur" }),
    );
    await runApiEffect(
      sales.webhook(paid, { userId: "sales-user", plan: "standard", interval: "month", currency: "eur" }),
    );
    await runApiEffect(
      sales.webhook(paid, { userId: "sales-user", plan: "standard", interval: "month", currency: "eur" }),
    );

    expect(
      database.prepare("SELECT fact_type, invoice_id FROM billing_sales_facts WHERE invoice_id = 'in_sales'").all(),
    ).toEqual([
      { fact_type: "payment_failed", invoice_id: "in_sales" },
      { fact_type: "payment_succeeded", invoice_id: "in_sales" },
    ]);
  });

  it("acknowledges late events after the account was deleted", async () => {
    const database = migratedDatabase("0031_billing_sales.sql");
    databases.push(database);
    database.exec(
      `INSERT INTO users(id, identity_key, email, created_at, updated_at)
       VALUES ('deleted-user', 'email:deleted@example.test', 'deleted@example.test', 1, 1);
       INSERT INTO billing_subscriptions(
         stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, amount,
         status, current_period_end, cancel_at_period_end, updated_at
       ) VALUES ('sub_deleted', 'deleted-user', 'cus_deleted', 'server-1', 'standard', 'month', 'eur', 1200,
         'active', 1, 0, 1);`,
    );
    const sales = service(database);
    await runApiEffect(sales.checkout({ ...checkout, userId: "deleted-user", sessionId: "cs_deleted" }));
    database.exec("DELETE FROM users WHERE id = 'deleted-user'");

    await expect(
      runApiEffect(
        sales.webhook(
          event("checkout.session.expired", "evt_deleted_expired", 1_700_000_030, {
            id: "cs_deleted",
            metadata: { openbot_user_id: "deleted-user" },
          }),
          null,
        ),
      ),
    ).resolves.toBeUndefined();
    await expect(
      runApiEffect(
        sales.webhook(
          event("invoice.paid", "evt_deleted_paid", 1_700_000_040, {
            id: "in_deleted",
            subscription: "sub_deleted",
            amount_paid: 1200,
            currency: "eur",
            metadata: { openbot_user_id: "deleted-user" },
          }),
          { userId: "deleted-user", plan: "standard", interval: "month", currency: "eur" },
        ),
      ),
    ).resolves.toBeUndefined();
    await expect(runApiEffect(sales.processPending())).resolves.toBeUndefined();

    expect(database.prepare("SELECT user_id, delivery_enqueued_at FROM billing_sales_facts").all()).toEqual(
      expect.arrayContaining([{ user_id: null, delivery_enqueued_at: expect.any(Number) }]),
    );
  });
});
