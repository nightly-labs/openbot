import { createHmac } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { getServerEntitlement } from "../src/server/billing-entitlement";
import { BillingService } from "../src/server/billing-service";
import { verifyStripeSignature } from "../src/server/stripe-client";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1";

const NOW = 1_780_000_000_000;
const WEBHOOK_SECRET = "whsec_test_secret";
const ORIGIN = "https://openbot.test";
const user = { id: "user-1" };
const databases: DatabaseSync[] = [];

/** The fields of a Stripe event object that the service reads. */
interface EventObject {
  id?: string;
  status?: string;
  subscription?: string;
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("Stripe webhook signature", () => {
  const payload = '{"id":"evt_1"}';
  const seconds = NOW / 1_000;

  it("accepts the signed body, and any v1 value during a secret rotation", async () => {
    expect(await verifyStripeSignature(payload, sign(payload, seconds), WEBHOOK_SECRET, NOW)).toBe(true);
    const rotated = `t=${seconds},v1=${"0".repeat(64)},v1=${hmac(payload, seconds, WEBHOOK_SECRET)}`;
    expect(await verifyStripeSignature(payload, rotated, WEBHOOK_SECRET, NOW)).toBe(true);
  });

  it.each([
    ["a changed body", '{"id":"evt_2"}', sign(payload, seconds)],
    ["an old timestamp", payload, sign(payload, seconds - 301)],
    ["another secret", payload, `t=${seconds},v1=${hmac(payload, seconds, "whsec_other")}`],
    ["no v1 value", payload, `t=${seconds},v0=${hmac(payload, seconds, WEBHOOK_SECRET)}`],
    ["no header", payload, null],
  ])("refuses %s", async (_name, body, header) => {
    expect(await verifyStripeSignature(body, header, WEBHOOK_SECRET, NOW)).toBe(false);
  });
});

describe("billing service", () => {
  it("links a subscription to its account and server from the metadata, and names only an owned server", async () => {
    const fixture = setup();
    fixture.stripe.subscriptions.set("sub_1", subscription("sub_1", "active", "openbot_standard_year", "host-1"));
    // A PLN plan on an EUR Price: the PLN amount is in `currency_options`.
    const plnPlan = subscription("sub_2", "active", "openbot_pro_month", "host-other");
    const [plnItem] = plnPlan.items.data;
    fixture.stripe.subscriptions.set("sub_2", {
      ...plnPlan,
      currency: "pln",
      items: {
        data: [{ ...plnItem, price: { ...plnItem?.price, currency_options: { pln: { unit_amount: 40_000 } } } }],
      },
    });
    await fixture.deliver("evt_1", "customer.subscription.created", { id: "sub_1" });
    await fixture.deliver("evt_2", "customer.subscription.created", { id: "sub_2" });

    expect(await fixture.service.getState(user.id)).toEqual({
      available: true,
      hasCustomer: true,
      servers: [
        expect.objectContaining({
          subscriptionId: "sub_1",
          serverId: "host-1",
          serverName: "Office",
          plan: "standard",
          currency: "eur",
          amount: 2_000,
        }),
        expect.objectContaining({
          subscriptionId: "sub_2",
          serverId: "host-other",
          serverName: null,
          plan: "pro",
          currency: "pln",
          amount: 40_000,
        }),
      ],
    });
    // Without the expand, Stripe omits `currency_options`.
    expect(fixture.stripe.lastSubscriptionExpand).toEqual(["items.data.price.currency_options"]);
    const d1 = sqliteD1(fixture.database);
    expect(await getServerEntitlement(d1, "host-1", NOW)).toMatchObject({ plan: "standard", storageGb: 50 });
    // The metadata of this account names a server of another account: that server gets no plan.
    expect(await getServerEntitlement(d1, "host-other", NOW)).toBeNull();
  });

  it("skips a subscription that names no account, and never moves a known customer", async () => {
    const fixture = setup();
    fixture.stripe.subscriptions.set("sub_1", {
      ...subscription("sub_1", "active", "openbot_starter_month"),
      metadata: {},
    });
    await fixture.deliver("evt_1", "customer.subscription.created", { id: "sub_1" });
    expect(await fixture.service.getState(user.id)).toEqual({ available: true, hasCustomer: false, servers: [] });

    fixture.stripe.subscriptions.set("sub_1", subscription("sub_1", "active", "openbot_starter_month"));
    await fixture.deliver("evt_2", "customer.subscription.updated", { id: "sub_1" });
    fixture.stripe.subscriptions.set("sub_1", {
      ...subscription("sub_1", "active", "openbot_pro_month"),
      metadata: { openbot_user_id: "user-2" },
    });
    await fixture.deliver("evt_3", "customer.subscription.updated", { id: "sub_1" });
    expect((await fixture.service.getState(user.id)).servers).toMatchObject([{ subscriptionId: "sub_1", plan: "pro" }]);
    expect((await fixture.service.getState("user-2")).servers).toEqual([]);
  });

  it("writes the latest Stripe state, ignores a repeated event, and applies a failed event on retry", async () => {
    const fixture = setup();
    fixture.stripe.subscriptions.set("sub_1", subscription("sub_1", "active", "openbot_starter_month"));
    await fixture.deliver("evt_1", "customer.subscription.created", { id: "sub_1" });

    // An old event that arrives late still writes the state that Stripe has now.
    fixture.stripe.subscriptions.set("sub_1", subscription("sub_1", "past_due", "openbot_starter_month"));
    await fixture.deliver("evt_0", "customer.subscription.updated", { id: "sub_1", status: "active" });
    expect((await fixture.service.getState(user.id)).servers[0]?.status).toBe("past_due");

    const reads = fixture.stripe.subscriptionReads;
    await fixture.deliver("evt_0", "customer.subscription.updated", { id: "sub_1" });
    expect(fixture.stripe.subscriptionReads).toBe(reads);

    fixture.stripe.subscriptions.set("sub_1", subscription("sub_1", "canceled", "openbot_starter_month"));
    fixture.stripe.failSubscriptionRead = true;
    await expect(fixture.deliver("evt_2", "customer.subscription.deleted", { id: "sub_1" })).rejects.toMatchObject({
      status: 502,
    });
    fixture.stripe.failSubscriptionRead = false;
    await fixture.deliver("evt_2", "customer.subscription.deleted", { id: "sub_1" });
    expect((await fixture.service.getState(user.id)).servers).toEqual([]);

    await expect(
      fixture.service.handleWebhook(event("evt_3", "customer.subscription.deleted", { id: "sub_1" }), "t=1,v1=00"),
    ).rejects.toMatchObject({ status: 400 });
    expect(fixture.database.prepare("SELECT event_id FROM billing_webhook_events ORDER BY event_id").all()).toEqual([
      { event_id: "evt_0" },
      { event_id: "evt_1" },
      { event_id: "evt_2" },
    ]);
  });

  it("opens the Portal on one plan only for a subscription of the same account", async () => {
    const fixture = setup();
    await expect(fixture.service.createPortal(user.id, { flow: "manage" }, "web", ORIGIN)).rejects.toMatchObject({
      status: 404,
    });
    fixture.stripe.subscriptions.set("sub_1", subscription("sub_1", "active", "openbot_standard_month", "host-1"));
    await fixture.deliver("evt_1", "customer.subscription.created", { id: "sub_1" });

    await fixture.service.createPortal(user.id, { flow: "manage" }, "desktop", ORIGIN);
    expect(Object.fromEntries(fixture.stripe.lastPortal ?? [])).toEqual({
      customer: "cus_1",
      return_url: `${ORIGIN}/billing/return`,
    });
    await fixture.service.createPortal(user.id, { flow: "cancel", subscriptionId: "sub_1" }, "web", ORIGIN);
    expect(Object.fromEntries(fixture.stripe.lastPortal ?? [])).toEqual({
      customer: "cus_1",
      return_url: `${ORIGIN}/app?billing=portal`,
      "flow_data[type]": "subscription_cancel",
      "flow_data[subscription_cancel][subscription]": "sub_1",
      "flow_data[after_completion][type]": "redirect",
      "flow_data[after_completion][redirect][return_url]": `${ORIGIN}/app?billing=portal`,
    });

    fixture.database.exec(`
      INSERT INTO billing_customers(user_id, stripe_customer_id, created_at, updated_at) VALUES ('user-2', 'cus_2', 1, 1);
    `);
    const portals = fixture.stripe.portalsCreated;
    await expect(
      fixture.service.createPortal("user-2", { flow: "update", subscriptionId: "sub_1" }, "web", ORIGIN),
    ).rejects.toMatchObject({ status: 404, code: "no_subscription" });
    expect(fixture.stripe.portalsCreated).toBe(portals);
  });

  it("gives a server its plan while it is paid, and while Stripe retries a payment until the period ends", async () => {
    const fixture = setup();
    const insert = (id: string, status: string, periodEnd: number) =>
      fixture.database
        .prepare(
          `INSERT INTO billing_subscriptions(
             stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, status,
             current_period_end, cancel_at_period_end, updated_at
           ) VALUES (?, 'user-1', 'cus_1', 'host-1', 'pro', 'month', 'eur', ?, ?, 0, 1)`,
        )
        .run(id, status, periodEnd);
    const d1 = sqliteD1(fixture.database);

    insert("sub_canceled", "canceled", NOW + 1_000);
    expect(await getServerEntitlement(d1, "host-1", NOW)).toBeNull();
    insert("sub_past_due", "past_due", NOW + 1_000);
    expect(await getServerEntitlement(d1, "host-1", NOW)).toMatchObject({ plan: "pro", storageGb: 100 });
    expect(await getServerEntitlement(d1, "host-1", NOW + 1_000)).toBeNull();
  });
});

function setup() {
  const database = migratedDatabase();
  databases.push(database);
  database.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
    VALUES ('user-1', 'email:one@example.test', 'one@example.test', 'One', NULL, 1, 1),
           ('user-2', 'email:two@example.test', 'two@example.test', 'Two', NULL, 1, 1);
    INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
    VALUES ('host-1', 'user-1', 'Office', 1, 1), ('host-other', 'user-2', 'Other', 1, 1);
  `);
  const stripe = new FakeStripe();
  const service = new BillingService({
    database: sqliteD1(database),
    secretKey: "sk_test_key",
    webhookSecret: WEBHOOK_SECRET,
    fetch: (input, init) => stripe.fetch(input, init),
    now: () => NOW,
  });
  return {
    database,
    stripe,
    service,
    deliver: (id: string, type: string, object: EventObject) => {
      const payload = event(id, type, object);
      return service.handleWebhook(payload, sign(payload, NOW / 1_000));
    },
  };
}

class FakeStripe {
  readonly subscriptions = new Map<string, unknown>();
  portalsCreated = 0;
  subscriptionReads = 0;
  failSubscriptionRead = false;
  lastPortal: URLSearchParams | null = null;
  lastSubscriptionExpand: string[] = [];

  async fetch(input: string, init: RequestInit): Promise<Response> {
    const url = new URL(input);
    if (init.method === "POST" && url.pathname === "/v1/billing_portal/sessions") {
      this.portalsCreated += 1;
      this.lastPortal = new URLSearchParams(typeof init.body === "string" ? init.body : "");
      return Response.json({ id: "bps_1", url: "https://billing.stripe.com/p/session/bps_1" });
    }
    const subscriptionId = /^\/v1\/subscriptions\/([^/]+)$/u.exec(url.pathname)?.[1];
    if (init.method === "GET" && subscriptionId) {
      this.subscriptionReads += 1;
      this.lastSubscriptionExpand = url.searchParams.getAll("expand[]");
      if (this.failSubscriptionRead) return Response.json({ error: { type: "api_error" } }, { status: 500 });
      const value = this.subscriptions.get(subscriptionId);
      return value
        ? Response.json(value)
        : Response.json({ error: { type: "invalid_request_error" } }, { status: 404 });
    }
    throw new Error(`Unexpected Stripe request ${init.method} ${url.pathname}`);
  }
}

/** A subscription of customer `cus_1` whose metadata names `user-1` and, optionally, a server. */
function subscription(id: string, status: string, lookupKey: string, serverId?: string) {
  return {
    id,
    customer: "cus_1",
    status,
    currency: "eur",
    cancel_at_period_end: false,
    metadata: { openbot_user_id: user.id, ...(serverId ? { openbot_server_id: serverId } : {}) },
    items: {
      data: [
        {
          current_period_end: NOW / 1_000 + 86_400,
          price: { id: "price", lookup_key: lookupKey, currency: "eur", unit_amount: 2_000 },
        },
      ],
    },
  };
}

function event(id: string, type: string, object: EventObject): string {
  return JSON.stringify({ id, type, created: NOW / 1_000, data: { object } });
}

function sign(payload: string, seconds: number): string {
  return `t=${seconds},v1=${hmac(payload, seconds, WEBHOOK_SECRET)}`;
}

function hmac(payload: string, seconds: number, secret: string): string {
  return createHmac("sha256", secret).update(`${seconds}.${payload}`).digest("hex");
}
