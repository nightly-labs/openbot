import { createHmac } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  BILLING_CURRENCIES,
  BILLING_INTERVALS,
  BILLING_PLAN_IDS,
  type BillingPlanId,
} from "@openbot/contracts/billing";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { exportJWK, generateKeyPair } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { type AccountAnalyticsEvent, accountEventProperties } from "../src/server/account-analytics";
import { BillingService } from "../src/server/billing-service";
import { sha256 } from "../src/server/crypto";
import { D1AuthRepository } from "../src/server/d1-auth-repository";
import { HostedServerService, sandboxName } from "../src/server/hosted-server-service";
import { RemoteControlPlane } from "../src/server/remote-control-plane";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1";

const owner = { id: "owner", email: "owner@example.test", name: null, avatarUrl: null };
const member = { id: "member", email: "member@example.test", name: null, avatarUrl: null };
const stranger = { id: "stranger", email: "stranger@example.test", name: null, avatarUrl: null };
const BOAT_WEBHOOK_SECRET = "whsec_boat";
const STRIPE_WEBHOOK_SECRET = "whsec_stripe";
const ORIGIN = "https://openbot.test";
const RETURN = { target: "desktop", origin: ORIGIN } as const;
const STARTER = { name: "Cloud one", plan: "starter", interval: "month", currency: "eur" } as const;
const MINUTE = 60_000;
/** boat stops a sandbox by itself this many seconds after its start. */
const LEASE = 7_200;
const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

interface Call {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
}

async function setup() {
  const database = migratedDatabase();
  databases.push(database);
  for (const user of [owner, member, stranger]) {
    database
      .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
      .run(user.id, `email:${user.email}`, user.email);
  }
  const clock = { now: Date.UTC(2026, 8, 1, 12) };
  const boatCalls: Call[] = [];
  const claims: string[] = [];
  let sandboxes = 0;
  /**
   * The next sandbox creates that boat refuses, as a boat trial does, whether boat refuses a smaller
   * machine, and the next creates whose answer is lost after boat made the sandbox.
   */
  const refusals = { creates: 0, shrink: false, lostAnswers: 0, beforeAnswer: () => {} };
  /** boat keeps the body of a create for its idempotency key, and returns the same sandbox for the same body. */
  const created = new Map<string, { body: string; id: string }>();
  const boatFetch = async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const call = {
      method: init.method ?? "GET",
      path: url.pathname.replace("/api/v1", ""),
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : null,
    };
    boatCalls.push(call);
    if (isDynamicRecord(call.body) && isDynamicRecord(call.body.env) && isString(call.body.env.OPENBOT_HOSTED_CLAIM)) {
      claims.push(call.body.env.OPENBOT_HOSTED_CLAIM);
    }
    if (call.method === "POST" && call.path === "/sandboxes") {
      if (refusals.creates > 0) {
        refusals.creates -= 1;
        return Response.json({ ok: false, code: "trial_auto_stop_required" }, { status: 400 });
      }
      const key = call.headers.get("Idempotency-Key") ?? "";
      const earlier = created.get(key);
      if (earlier && earlier.body !== init.body) {
        return Response.json({ ok: false, code: "idempotency_key_reused" }, { status: 409 });
      }
      if (!earlier) sandboxes += 1;
      const id = earlier?.id ?? `bx_${sandboxes}`;
      created.set(key, { body: String(init.body), id });
      if (refusals.lostAnswers > 0) {
        refusals.lostAnswers -= 1;
        throw new TypeError("fetch failed");
      }
      refusals.beforeAnswer();
      return Response.json({ ok: true, status: "provisioning", sandbox: { id, state: "provisioning" } });
    }
    if (refusals.shrink && call.path.endsWith("/resume") && isDynamicRecord(call.body) && call.body.type === "small") {
      return Response.json({ ok: false, code: "type_too_small" }, { status: 409 });
    }
    return Response.json({ ok: true, id: "bx_1", status: "ok" });
  };
  const pair = await generateKeyPair("ES256", { extractable: true });
  const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", use: "sig", alg: "ES256" };
  const bindings = {
    DB: sqliteD1(database),
    REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ ...(await exportJWK(pair.privateKey)), kid: "test-key", alg: "ES256" }),
    REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [publicJwk] }),
    REMOTE_TICKET_KEY_ID: "test-key",
    HOSTED_SERVERS_ENABLED: "true",
    HOSTED_SERVERS_ALLOWED_USER_IDS: "owner, member",
    HOSTED_SERVER_TEMPLATE: "openbot-server-test",
    BOAT_API_KEY: "boat-key",
    BOAT_WEBHOOK_SECRET: BOAT_WEBHOOK_SECRET,
  };
  const stripe = new FakeStripe();
  const events: { accountId: string; event: AccountAnalyticsEvent }[] = [];
  const analytics = { track: (accountId: string, event: AccountAnalyticsEvent) => events.push({ accountId, event }) };
  const remote = new RemoteControlPlane(bindings, { now: () => clock.now, fetch: async () => new Response(null) });
  const billing = new BillingService({
    database: bindings.DB,
    // A key for each test run: the Price catalog is cached for each key.
    secretKey: `sk_test_${crypto.randomUUID()}`,
    webhookSecret: STRIPE_WEBHOOK_SECRET,
    fetch: (input, init) => stripe.fetch(input, init),
    now: () => clock.now,
    onSubscriptionSynced: (sync) => service.onSubscriptionSynced(sync),
    analytics,
  });
  const service = new HostedServerService(bindings, {
    fetch: boatFetch,
    now: () => clock.now,
    removeHost: (ownerUserId, hostId) => remote.deleteHost(ownerUserId, hostId),
    billing,
    analytics,
  });
  let delivery = 0;
  const boatWebhook = (
    type: string,
    state: string | null,
    options: { createdAt?: number; timestamp?: number; sandboxId?: string } = {},
  ) => {
    delivery += 1;
    const body = JSON.stringify({
      id: `evt_${delivery}`,
      type,
      createdAt: new Date(options.createdAt ?? clock.now).toISOString(),
      data: { sandbox: { id: options.sandboxId ?? "bx_1", name: "server" }, ...(state ? { state } : {}) },
    });
    const timestamp = String(Math.floor((options.timestamp ?? clock.now) / 1_000));
    const deliveryId = `evt_${delivery}`;
    const signature = `v1=${createHmac("sha256", BOAT_WEBHOOK_SECRET).update(`${deliveryId}.${timestamp}.${body}`).digest("hex")}`;
    return { deliveryId, timestamp, signature, body };
  };
  /** Stripe stores the subscription in this state and sends the webhook. */
  const stripeSync = (
    subscriptionId: string,
    status: string,
    serverId: string,
    customer = "cus_1",
    plan: BillingPlanId = "starter",
  ) => {
    stripe.subscriptions.set(subscriptionId, subscription(subscriptionId, status, serverId, customer, clock.now, plan));
    delivery += 1;
    const payload = JSON.stringify({
      id: `evt_stripe_${delivery}`,
      type: "customer.subscription.updated",
      created: Math.floor(clock.now / 1_000),
      data: { object: { id: subscriptionId } },
    });
    const seconds = Math.floor(clock.now / 1_000);
    const signature = `t=${seconds},v1=${createHmac("sha256", STRIPE_WEBHOOK_SECRET).update(`${seconds}.${payload}`).digest("hex")}`;
    return billing.handleWebhook(payload, signature);
  };
  const state = (serverId: string) =>
    database
      .prepare(
        `SELECT desired_state, observed_state, observed_error, last_wake_reason, checkout_session_id, size, pending_size,
           next_run_at
         FROM hosted_servers WHERE server_id = ?`,
      )
      .get(serverId);
  const sandboxCreates = () => boatCalls.filter((call) => call.method === "POST" && call.path === "/sandboxes");
  return {
    database,
    clock,
    boatCalls,
    claims,
    refusals,
    stripe,
    remote,
    service,
    boatWebhook,
    stripeSync,
    state,
    sandboxCreates,
    events,
  };
}

type Context = Awaited<ReturnType<typeof setup>>;

async function createPaidServer(context: Context, key = "create-key-0000001") {
  const { server } = await context.service.create(owner, STARTER, key, RETURN);
  await context.stripeSync("sub_1", "active", server.serverId);
  return server;
}

async function createRunningServer(context: Context) {
  const server = await createPaidServer(context);
  await context.service.handleWebhook(context.boatWebhook("sandbox.ready", "ready"));
  await context.remote.registerHost(owner, {
    hostId: server.serverId,
    name: "Cloud one",
    ownerMembershipId: `${server.serverId}:owner`,
  });
  return server;
}

describe("hosted servers", () => {
  it("makes a sandbox only after Stripe confirms the payment, once, with a single-use claim", async () => {
    const context = await setup();
    await expect(context.service.list(stranger)).resolves.toEqual({ available: false, servers: [] });
    await expect(context.service.create(stranger, STARTER, "create-key-0000001", RETURN)).rejects.toMatchObject({
      status: 403,
      code: "hosting_unavailable",
    });

    const first = await context.service.create(
      owner,
      { ...STARTER, name: " Cloud one " },
      "create-key-0000001",
      RETURN,
    );
    const { server } = first;
    expect(server).toMatchObject({ name: "Cloud one", size: "small", plan: "starter", state: "awaiting_payment" });
    expect(first.checkoutUrl).toBe("https://checkout.stripe.com/c/pay/cs_1");
    expect(context.sandboxCreates()).toHaveLength(0);
    expect(Object.fromEntries(context.stripe.checkouts[0] ?? [])).toMatchObject({
      mode: "subscription",
      customer: "cus_1",
      "line_items[0][price]": "price_starter_month",
      currency: "eur",
      client_reference_id: server.serverId,
      success_url: `${ORIGIN}/billing/return`,
      "subscription_data[metadata][openbot_server_id]": server.serverId,
      "subscription_data[metadata][openbot_user_id]": "owner",
    });

    // A repeated submit closes the first page, so only one page can take a payment.
    const again = await context.service.create(owner, STARTER, "create-key-0000001", RETURN);
    expect(again.server.serverId).toBe(server.serverId);
    expect(again.checkoutUrl).toBe("https://checkout.stripe.com/c/pay/cs_2");
    expect(context.stripe.sessions.get("cs_1")).toBe("expired");
    expect(context.stripe.customersCreated).toBe(1);

    // Stripe makes the subscription before the payment is done: no sandbox yet.
    await context.stripeSync("sub_1", "incomplete", server.serverId);
    expect(context.sandboxCreates()).toHaveLength(0);
    await context.stripeSync("sub_1", "active", server.serverId);
    await context.stripeSync("sub_1", "active", server.serverId);
    const creates = context.sandboxCreates();
    expect(creates).toHaveLength(1);
    expect(creates[0]?.headers.get("Idempotency-Key")).toBe(server.serverId);
    expect(creates[0]?.body).toMatchObject({
      type: "small",
      from: "openbot-server-test",
      env: { OPENBOT_HOSTED_HOST_ID: server.serverId },
      ttlSeconds: LEASE,
    });
    expect(context.state(server.serverId)).toMatchObject({ observed_state: "starting", checkout_session_id: null });
    // A paid page cannot open again.
    await expect(context.service.checkout(owner, server.serverId, RETURN)).resolves.toMatchObject({
      checkoutUrl: null,
    });

    const [claim = ""] = context.claims;
    expect(JSON.stringify(context.database.prepare("SELECT * FROM hosted_servers").all())).not.toContain(claim);
    const redeemed = await context.service.redeemClaim(claim);
    expect(redeemed).toMatchObject({ hostId: server.serverId, name: "Cloud one", user: { id: "owner" } });
    await expect(
      new D1AuthRepository(sqliteD1(context.database)).authenticate(redeemed.sessionToken, context.clock.now),
    ).resolves.toMatchObject({ id: "owner" });
    // A server whose response was lost redeems again. The new session replaces the first one.
    const retried = await context.service.redeemClaim(claim);
    const auth = new D1AuthRepository(sqliteD1(context.database));
    await expect(auth.authenticate(retried.sessionToken, context.clock.now)).resolves.toMatchObject({ id: "owner" });
    await expect(auth.authenticate(redeemed.sessionToken, context.clock.now)).resolves.toBeNull();
    context.clock.now += 11 * MINUTE;
    await expect(context.service.redeemClaim(claim)).rejects.toMatchObject({ code: "hosted_claim_invalid" });
    await expect(auth.authenticate(retried.sessionToken, context.clock.now)).resolves.toMatchObject({ id: "owner" });

    // The claim lifetime counts from the payment, not from the create request.
    const second = await context.service.create(owner, { ...STARTER, plan: "pro" }, "create-key-0000002", RETURN);
    context.clock.now += 2 * 60 * MINUTE;
    await context.stripeSync("sub_2", "active", second.server.serverId, "cus_1", "pro");
    expect(context.sandboxCreates().at(-1)?.body).toMatchObject({ type: "large" });
    const secondClaim = context.claims.at(-1) ?? "";
    context.clock.now += 61 * MINUTE;
    await expect(context.service.redeemClaim(secondClaim)).rejects.toMatchObject({ code: "hosted_claim_invalid" });
  });

  it("gives no sandbox to a server that the paid subscription's account does not own", async () => {
    const context = await setup();
    const { server } = await context.service.create(member, STARTER, "create-key-0000001", RETURN);
    // The owner's customer pays, and the metadata names the member's server.
    await context.stripeSync("sub_1", "active", server.serverId, "cus_owner");
    await context.service.tick(context.clock.now + 5 * MINUTE);
    expect(context.sandboxCreates()).toHaveLength(0);
    expect(context.state(server.serverId)).toMatchObject({ observed_state: "awaiting_payment" });
  });

  it("stops a server whose plan ended and keeps it, and starts it again when the plan is renewed", async () => {
    const context = await setup();
    const server = await createRunningServer(context);
    context.database
      .prepare(
        `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
         VALUES ('member-1', ?, 'member', 'member', 'active', 1, 1)`,
      )
      .run(server.serverId);
    const calls = (path: string) => context.boatCalls.filter((call) => call.path === path).length;

    context.clock.now += MINUTE;
    await context.stripeSync("sub_1", "unpaid", server.serverId);
    expect(context.state(server.serverId)).toMatchObject({
      desired_state: "stopped",
      observed_state: "stopping",
      observed_error: "plan_ended",
    });
    expect(calls("/sandboxes/bx_1/stop")).toBe(1);
    await expect(context.service.wake(member, server.serverId)).rejects.toMatchObject({
      status: 402,
      code: "plan_required",
    });
    // An open plan that is not paid gets its payment in the Customer Portal, not a second plan.
    await expect(context.service.checkout(owner, server.serverId, RETURN)).rejects.toMatchObject({
      status: 409,
      code: "hosted_server_payment_due",
    });
    await context.stripeSync("sub_1", "canceled", server.serverId);
    expect(calls("/sandboxes/bx_1/stop")).toBe(1);

    context.clock.now += MINUTE;
    await context.service.handleWebhook(context.boatWebhook("sandbox.archived", "archived"));
    await context.service.tick(context.clock.now + 5 * MINUTE);
    expect(context.state(server.serverId)).toMatchObject({ observed_state: "stopped", observed_error: "plan_ended" });
    expect(calls("/sandboxes/bx_1/resume")).toBe(0);
    expect(context.boatCalls.some((call) => call.method === "DELETE")).toBe(false);
    await expect(context.service.list(owner)).resolves.toMatchObject({
      servers: [{ serverId: server.serverId, state: "stopped", error: "plan_ended" }],
    });

    // A cancelled plan is renewed with a new Checkout page.
    const renewal = await context.service.checkout(owner, server.serverId, RETURN);
    expect(renewal.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//u);
    context.clock.now += MINUTE;
    await context.stripeSync("sub_2", "active", server.serverId);
    expect(calls("/sandboxes/bx_1/resume")).toBe(1);
    expect(context.state(server.serverId)).toMatchObject({
      desired_state: "running",
      observed_state: "waking",
      observed_error: null,
    });
  });

  it("cancels the plan when the owner deletes a paid server, and keeps the server when Stripe fails", async () => {
    const context = await setup();
    const server = await createRunningServer(context);
    context.stripe.failCancel = true;
    await expect(context.service.delete(owner, server.serverId, "Cloud one")).rejects.toMatchObject({
      status: 502,
      code: "hosted_server_billing_failed",
    });
    expect(context.state(server.serverId)).toMatchObject({ desired_state: "running", observed_state: "running" });
    expect(context.boatCalls.some((call) => call.method === "DELETE")).toBe(false);

    context.stripe.failCancel = false;
    await context.service.delete(owner, server.serverId, "Cloud one");
    expect(context.stripe.cancelled).toEqual(["sub_1"]);
    expect(context.boatCalls.find((call) => call.method === "DELETE")?.path).toBe("/sandboxes/bx_1");

    // A payment that finishes after the owner deleted the server is cancelled, and makes no sandbox.
    const unpaid = await context.service.create(owner, STARTER, "create-key-0000002", RETURN);
    await context.service.delete(owner, unpaid.server.serverId, "Cloud one");
    expect(context.stripe.sessions.get("cs_2")).toBe("expired");
    await context.stripeSync("sub_late", "active", unpaid.server.serverId);
    expect(context.stripe.cancelled).toEqual(["sub_1", "sub_late"]);
    expect(context.sandboxCreates()).toHaveLength(1);
  });

  it("applies a missed payment or plan end on the cron, and removes a server that is not paid in a day", async () => {
    const context = await setup();
    const paid = await context.service.create(owner, STARTER, "create-key-0000001", RETURN);
    const unpaid = await context.service.create(owner, STARTER, "create-key-0000002", RETURN);
    // Paid at the last minute, and each webhook delivery fails.
    const paidLate = await context.service.create(owner, STARTER, "create-key-0000003", RETURN);
    context.stripe.sessions.set("cs_3", "complete");
    context.stripe.sessionSubscriptions.set("cs_3", "sub_late");
    context.stripe.subscriptions.set(
      "sub_late",
      subscription("sub_late", "active", paidLate.server.serverId, "cus_1", context.clock.now, "starter"),
    );
    // The webhook stored the subscription, but the hosting step failed.
    context.database
      .prepare(
        `INSERT INTO billing_subscriptions(
           stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, status,
           current_period_end, cancel_at_period_end, updated_at
         ) VALUES ('sub_1', 'owner', 'cus_1', ?, 'starter', 'month', 'eur', 'active', ?, 0, 1)`,
      )
      .run(paid.server.serverId, context.clock.now + 30 * 24 * 60 * MINUTE);

    context.clock.now += 5 * MINUTE;
    await expect(context.service.tick()).resolves.toMatchObject({ provisioned: 1, abandoned: 0, failed: 0 });
    expect(context.sandboxCreates()).toHaveLength(1);
    await context.service.handleWebhook(context.boatWebhook("sandbox.ready", "ready"));

    context.database.exec("UPDATE billing_subscriptions SET status = 'canceled'");
    context.clock.now += 5 * MINUTE;
    await expect(context.service.tick()).resolves.toMatchObject({ stopped: 1 });
    expect(context.state(paid.server.serverId)).toMatchObject({ desired_state: "stopped", observed_state: "stopping" });

    context.clock.now += 24 * 60 * MINUTE;
    await expect(context.service.tick()).resolves.toMatchObject({ abandoned: 1 });
    expect(context.state(unpaid.server.serverId)).toMatchObject({
      desired_state: "deleted",
      observed_state: "deleted",
    });
    // The paid page gives the plan that no webhook stored, so the server is set up.
    expect(context.state(paidLate.server.serverId)).toMatchObject({ desired_state: "running" });
    expect(context.sandboxCreates()).toHaveLength(2);
    // A server with a plan that ended keeps its data.
    await expect(context.service.list(owner)).resolves.toMatchObject({
      servers: [
        { serverId: paid.server.serverId, state: "stopping" },
        { serverId: paidLate.server.serverId, state: "starting" },
      ],
    });
  });

  it("recovers a setup that stopped before boat answered, and finishes a delete that came during it", async () => {
    const context = await setup();
    const lost = await context.service.create(owner, STARTER, "create-key-0000001", RETURN);
    const deleted = await context.service.create(owner, STARTER, "create-key-0000002", RETURN);
    context.database
      .prepare(
        `INSERT INTO billing_subscriptions(
           stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, status,
           current_period_end, cancel_at_period_end, updated_at
         ) VALUES ('sub_1', 'owner', 'cus_1', ?, 'starter', 'month', 'eur', 'active', ?, 0, 1)`,
      )
      .run(lost.server.serverId, context.clock.now + 30 * 24 * 60 * MINUTE);
    // The Worker stopped after the claim and before boat answered.
    context.database.exec("UPDATE hosted_servers SET observed_state = 'creating', checkout_session_id = NULL");

    // A delete does not wait for the create, and does not forget a sandbox that it can still return.
    await context.service.delete(owner, deleted.server.serverId, "Cloud one");
    expect(context.state(deleted.server.serverId)).toMatchObject({
      desired_state: "deleted",
      observed_state: "creating",
    });

    context.clock.now += 10 * MINUTE;
    await context.service.tick();
    expect(context.state(lost.server.serverId)).toMatchObject({
      observed_state: "error",
      observed_error: "provider_error",
    });
    expect(context.state(deleted.server.serverId)).toMatchObject({ observed_state: "deleted" });
    context.clock.now += 11 * MINUTE;
    await expect(context.service.tick()).resolves.toMatchObject({ provisioned: 1 });
    expect(context.sandboxCreates()).toHaveLength(1);
    expect(context.state(lost.server.serverId)).toMatchObject({ observed_state: "starting", observed_error: null });
  });

  it("sends account events with only allowlisted values, and no email or server ID", async () => {
    const context = await setup();
    const server = await createRunningServer(context);
    await context.service.delete(owner, server.serverId, "Cloud one");
    expect(context.events.map(({ accountId, event }) => [accountId, event.name, event.action])).toEqual([
      ["owner", "billing_action", "checkout_started"],
      ["owner", "billing_action", "plan_started"],
      ["owner", "hosted_server_action", "provisioned"],
      ["owner", "billing_action", "plan_ended"],
      ["owner", "hosted_server_action", "deleted"],
    ]);
    const sent = JSON.stringify(context.events.map(({ event }) => accountEventProperties(event)));
    expect(sent).not.toContain(owner.email);
    expect(sent).not.toContain(server.serverId);
    expect(sent).not.toContain("cus_1");
    expect(sent).not.toContain("sub_1");
    // A value from outside the allowlist is dropped, and an unknown event is not sent.
    const untrusted: AccountAnalyticsEvent = JSON.parse(
      `{"name":"billing_action","action":"plan_changed","plan":"${owner.email}","flow":"${server.serverId}"}`,
    );
    expect(JSON.stringify(accountEventProperties(untrusted))).not.toContain("example");
    expect(accountEventProperties(JSON.parse(`{"name":"billing_action","action":"${owner.email}"}`))).toBeNull();
  });

  it("sets up a paid server again after its setup failed, and only while the plan is open", async () => {
    const context = await setup();
    context.refusals.creates = 2;
    const server = await createPaidServer(context);
    expect(context.state(server.serverId)).toMatchObject({
      observed_state: "error",
      observed_error: "provider_billing",
    });

    // Retry in the dialog tries at once. The cron waits, so a failure does not repeat each minute.
    await expect(context.service.wake(owner, server.serverId)).resolves.toMatchObject({ state: "error" });
    expect(context.sandboxCreates()).toHaveLength(2);
    context.clock.now += 5 * MINUTE;
    await expect(context.service.tick()).resolves.toMatchObject({ provisioned: 0 });
    context.clock.now += 6 * MINUTE;
    await expect(context.service.tick()).resolves.toMatchObject({ provisioned: 1, failed: 0 });
    const creates = context.sandboxCreates();
    expect(creates).toHaveLength(3);
    // Each attempt sends the same key and body, so boat makes at most one sandbox.
    expect(creates.map((call) => call.headers.get("Idempotency-Key"))).toEqual(Array(3).fill(server.serverId));
    expect(new Set(creates.map((call) => JSON.stringify(call.body))).size).toBe(1);
    expect(context.state(server.serverId)).toMatchObject({ observed_state: "starting", observed_error: null });
    await expect(context.service.redeemClaim(context.claims[0])).resolves.toMatchObject({ hostId: server.serverId });

    // A server whose setup failed and whose plan ended is not set up again until the plan is renewed.
    const failed = await context.service.create(owner, STARTER, "create-key-0000002", RETURN);
    context.refusals.creates = 1;
    await context.stripeSync("sub_2", "active", failed.server.serverId);
    context.clock.now += MINUTE;
    await context.stripeSync("sub_2", "canceled", failed.server.serverId);
    expect(context.state(failed.server.serverId)).toMatchObject({ desired_state: "stopped", observed_state: "error" });
    context.clock.now += 11 * MINUTE;
    await expect(context.service.tick()).resolves.toMatchObject({ provisioned: 0 });
    expect(context.sandboxCreates()).toHaveLength(4);
    await context.service.checkout(owner, failed.server.serverId, RETURN);
    await context.stripeSync("sub_3", "active", failed.server.serverId);
    expect(context.sandboxCreates()).toHaveLength(5);
    expect(context.state(failed.server.serverId)).toMatchObject({
      desired_state: "running",
      observed_state: "starting",
    });
  });

  it("keeps the sandbox of a create whose answer was lost, and lets a VM that never signed in sign in later", async () => {
    const context = await setup();
    const sandboxOf = (serverId: string) =>
      context.database.prepare("SELECT provider_sandbox_id FROM hosted_servers WHERE server_id = ?").get(serverId);
    // boat makes the sandbox, and the answers to the create and to its retry are lost.
    context.refusals.lostAnswers = 2;
    const server = await createPaidServer(context);
    expect(context.state(server.serverId)).toMatchObject({ observed_state: "error", observed_error: "provider_error" });
    context.clock.now += 11 * MINUTE;
    await expect(context.service.tick()).resolves.toMatchObject({ provisioned: 1, failed: 0 });
    expect(context.sandboxCreates()).toHaveLength(3);
    expect(sandboxOf(server.serverId)).toEqual({ provider_sandbox_id: "bx_1" });
    expect(context.state(server.serverId)).toMatchObject({ observed_state: "starting", observed_error: null });

    // The VM did not sign in within the hour. Its next start makes the claim work again, one time.
    const [claim = ""] = context.claims;
    await context.service.handleWebhook(context.boatWebhook("sandbox.ready", "ready"));
    context.clock.now += 61 * MINUTE;
    await expect(context.service.tick()).resolves.toMatchObject({ idle: 1 });
    await context.service.handleWebhook(context.boatWebhook("sandbox.archived", "archived"));
    await expect(context.service.redeemClaim(claim)).rejects.toMatchObject({ code: "hosted_claim_invalid" });
    await context.service.wake(owner, server.serverId);
    await expect(context.service.redeemClaim(claim)).resolves.toMatchObject({ hostId: server.serverId });
    context.clock.now += 11 * MINUTE;
    await context.service.handleWebhook(context.boatWebhook("sandbox.ready", "ready"));
    context.clock.now += 16 * MINUTE;
    await expect(context.service.tick()).resolves.toMatchObject({ idle: 1 });
    await context.service.handleWebhook(context.boatWebhook("sandbox.archived", "archived"));
    await context.service.wake(owner, server.serverId);
    await expect(context.service.redeemClaim(claim)).rejects.toMatchObject({ code: "hosted_claim_invalid" });

    // The owner revoked the session of the server. Its next start makes the claim work again.
    context.database
      .prepare(
        "UPDATE auth_sessions SET revoked_at = 1 WHERE id = (SELECT auth_session_id FROM hosted_servers WHERE server_id = ?)",
      )
      .run(server.serverId);
    await context.service.handleWebhook(context.boatWebhook("sandbox.ready", "ready"));
    context.clock.now += 16 * MINUTE;
    await expect(context.service.tick()).resolves.toMatchObject({ idle: 1 });
    await context.service.handleWebhook(context.boatWebhook("sandbox.archived", "archived"));
    await context.service.wake(owner, server.serverId);
    await expect(context.service.redeemClaim(claim)).resolves.toMatchObject({ hostId: server.serverId });

    // The cron gave up on a create that boat answers later. The row keeps that sandbox.
    const late = await context.service.create(owner, STARTER, "create-key-0000002", RETURN);
    context.refusals.beforeAnswer = () => {
      context.database
        .prepare(
          "UPDATE hosted_servers SET observed_state = 'error', observed_error = 'provider_error' WHERE server_id = ?",
        )
        .run(late.server.serverId);
    };
    await context.stripeSync("sub_2", "active", late.server.serverId);
    expect(sandboxOf(late.server.serverId)).toEqual({ provider_sandbox_id: "bx_2" });
    expect(context.state(late.server.serverId)).toMatchObject({ observed_state: "starting", observed_error: null });
    expect(context.boatCalls.filter((call) => call.method === "DELETE")).toHaveLength(0);

    // A delete before the setup retry finds the sandbox of a lost create, and deletes it.
    context.refusals.beforeAnswer = () => {};
    context.refusals.lostAnswers = 2;
    const lost = await context.service.create(owner, STARTER, "create-key-0000003", RETURN);
    await context.stripeSync("sub_3", "active", lost.server.serverId);
    expect(context.state(lost.server.serverId)).toMatchObject({ observed_state: "error" });
    await context.service.delete(owner, lost.server.serverId, lost.server.name);
    expect(context.boatCalls.filter((call) => call.method === "DELETE").map((call) => call.path)).toEqual([
      "/sandboxes/bx_3",
    ]);
  });

  it("moves a server to the machine of its new plan, and keeps its machine when the data does not fit", async () => {
    const context = await setup();
    const server = await createPaidServer(context);
    const calls = (path: string) => context.boatCalls.filter((call) => call.path === `/sandboxes/bx_1/${path}`);

    // The upgrade comes while the sandbox starts. The cron stops it when it runs.
    await context.stripeSync("sub_1", "active", server.serverId, "cus_1", "pro");
    expect(context.state(server.serverId)).toMatchObject({ size: "small", pending_size: "large" });
    await context.service.handleWebhook(context.boatWebhook("sandbox.ready", "ready"));
    expect(calls("stop")).toHaveLength(0);
    context.clock.now += 3 * MINUTE;
    await expect(context.service.tick()).resolves.toMatchObject({ resized: 1, failed: 0 });
    expect(calls("stop")).toHaveLength(1);
    expect(context.state(server.serverId)).toMatchObject({ desired_state: "running", observed_state: "stopping" });
    context.clock.now += MINUTE;
    await context.service.handleWebhook(context.boatWebhook("sandbox.archived", "archived"));
    expect(calls("resume").map((call) => call.body)).toEqual([{ ttlSeconds: LEASE, type: "large" }]);
    expect(context.state(server.serverId)).toMatchObject({
      observed_state: "waking",
      size: "large",
      pending_size: null,
    });

    // boat refuses a smaller machine that cannot hold the data. The server starts on its machine.
    context.refusals.shrink = true;
    context.clock.now += MINUTE;
    await context.service.handleWebhook(context.boatWebhook("sandbox.ready", "ready"));
    await context.stripeSync("sub_1", "active", server.serverId, "cus_1", "starter");
    expect(calls("stop")).toHaveLength(2);
    context.clock.now += MINUTE;
    await context.service.handleWebhook(context.boatWebhook("sandbox.archived", "archived"));
    expect(calls("resume").map((call) => call.body)).toEqual([
      { ttlSeconds: LEASE, type: "large" },
      { ttlSeconds: LEASE, type: "small" },
      { ttlSeconds: LEASE },
    ]);
    expect(context.state(server.serverId)).toMatchObject({
      observed_state: "waking",
      size: "large",
      pending_size: null,
    });
    context.clock.now += MINUTE;
    await context.service.handleWebhook(context.boatWebhook("sandbox.ready", "ready"));
    context.clock.now += 3 * MINUTE;
    await expect(context.service.tick()).resolves.toMatchObject({ resized: 0 });
    expect(calls("stop")).toHaveLength(2);
    await expect(context.service.list(owner)).resolves.toMatchObject({
      servers: [{ serverId: server.serverId, plan: "starter", size: "large", state: "running" }],
    });
  });

  it("reserves the host ID for its owner and removes the host on deletion", async () => {
    const context = await setup();
    const server = await createPaidServer(context);
    const [claim = ""] = context.claims;
    const session = await context.service.redeemClaim(claim);
    const hostInput = { hostId: server.serverId, name: "Cloud one", ownerMembershipId: `${server.serverId}:owner` };
    await expect(context.remote.registerHost(stranger, hostInput)).rejects.toMatchObject({
      code: "host_owner_mismatch",
    });
    await context.remote.registerHost(owner, hostInput);

    await expect(context.service.delete(stranger, server.serverId, "Cloud one")).rejects.toMatchObject({
      status: 404,
    });
    await expect(context.service.delete(owner, server.serverId, "Cloud")).rejects.toMatchObject({
      code: "hosted_server_confirm_mismatch",
    });
    await context.service.delete(owner, server.serverId, "Cloud one");
    const deletion = context.boatCalls.find((call) => call.method === "DELETE");
    expect(deletion?.path).toBe("/sandboxes/bx_1");
    expect(deletion?.headers.get("X-Ascii-Confirm-Delete")).toBe("bx_1");
    expect(context.database.prepare("SELECT host_id FROM remote_hosts").all()).toEqual([]);
    await expect(
      new D1AuthRepository(sqliteD1(context.database)).authenticate(session.sessionToken, context.clock.now),
    ).resolves.toBeNull();
    await expect(context.remote.registerHost(owner, hostInput)).rejects.toMatchObject({
      code: "host_owner_mismatch",
    });
    await expect(context.service.list(owner)).resolves.toMatchObject({ servers: [] });
  });

  it("checks webhook signatures, applies each delivery once, and ignores older events", async () => {
    const context = await setup();
    const server = await createPaidServer(context);
    const forged = context.boatWebhook("sandbox.ready", "ready");
    await expect(context.service.handleWebhook({ ...forged, signature: `v1=${"0".repeat(64)}` })).rejects.toMatchObject(
      { status: 401 },
    );
    const stale = context.boatWebhook("sandbox.ready", "ready", { timestamp: context.clock.now - 6 * MINUTE });
    await expect(context.service.handleWebhook(stale)).rejects.toMatchObject({ status: 401 });
    expect(context.state(server.serverId)).toMatchObject({ observed_state: "starting" });

    await context.service.handleWebhook(context.boatWebhook("sandbox.ready", "ready"));
    expect(context.state(server.serverId)).toMatchObject({ observed_state: "running" });
    const olderError = context.boatWebhook("sandbox.error", null, { createdAt: context.clock.now - MINUTE });
    await context.service.handleWebhook(olderError);
    expect(context.state(server.serverId)).toMatchObject({ observed_state: "running" });

    context.clock.now += MINUTE;
    const error = context.boatWebhook("sandbox.error", null);
    await context.service.handleWebhook(error);
    expect(context.state(server.serverId)).toMatchObject({ observed_state: "error" });
    context.clock.now += MINUTE;
    await context.service.handleWebhook(context.boatWebhook("sandbox.ready", "ready"));
    // The same delivery again changes nothing.
    await context.service.handleWebhook(error);
    expect(context.state(server.serverId)).toMatchObject({ observed_state: "running" });
  });

  it("starts a server again when the provider stops it, and lets a member start a failed one", async () => {
    const context = await setup();
    const server = await createRunningServer(context);
    context.database
      .prepare(
        `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
         VALUES ('member-1', ?, 'member', 'member', 'active', 1, 1)`,
      )
      .run(server.serverId);
    const resumes = () => context.boatCalls.filter((call) => call.path === "/sandboxes/bx_1/resume").length;

    context.clock.now += MINUTE;
    await context.service.handleWebhook(context.boatWebhook("sandbox.ready", "archiving"));
    await expect(context.service.wake(stranger, server.serverId)).rejects.toMatchObject({ status: 404 });
    await expect(context.service.wake(member, server.serverId)).resolves.toMatchObject({ state: "stopping" });
    expect(resumes()).toBe(0);

    context.clock.now += MINUTE;
    await context.service.handleWebhook(context.boatWebhook("sandbox.archived", "archived"));
    expect(resumes()).toBe(1);
    expect(context.state(server.serverId)).toMatchObject({
      desired_state: "running",
      observed_state: "waking",
      last_wake_reason: "restart",
    });

    context.clock.now += MINUTE;
    await context.service.handleWebhook(context.boatWebhook("sandbox.error", null));
    await expect(context.service.wake(member, server.serverId)).resolves.toMatchObject({ state: "waking" });
    expect(resumes()).toBe(2);
    expect(context.state(server.serverId)).toMatchObject({ last_wake_reason: "message" });
  });

  it("stops a server with no use for 15 minutes, keeps it, and starts it on the next use", async () => {
    const context = await setup();
    const server = await createRunningServer(context);
    const { sessionToken } = await context.service.redeemClaim(context.claims[0]);
    const ownerToken = "owner-session-token-0001";
    context.database
      .prepare(
        `INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
         VALUES ('owner-session', 'owner', ?, ?, 1, 1)`,
      )
      .run(await sha256(ownerToken), context.clock.now + 60 * MINUTE);
    const calls = (path: string) => context.boatCalls.filter((call) => call.path === path);
    const leases = () =>
      calls("/sandboxes/bx_1").filter((call) => isDynamicRecord(call.body) && "ttlSeconds" in call.body);
    // The display name tells the operator the plan and the owner. It is deterministic.
    expect(calls("/sandboxes/bx_1").map((call) => [call.method, call.body])).toEqual([
      ["PATCH", { name: sandboxName("starter", owner.email, server.serverId) }],
    ]);
    expect(sandboxName("starter", owner.email, server.serverId)).toBe(
      `openbot-starter-owner-example-test-${server.serverId.slice(0, 8)}`,
    );

    // Only the session of the server can keep it running.
    await expect(context.service.reportActivity(ownerToken, server.serverId, { inUse: true })).rejects.toMatchObject({
      status: 404,
    });
    context.clock.now += 14 * MINUTE;
    await context.service.reportActivity(sessionToken, server.serverId, { inUse: true });
    context.clock.now += 14 * MINUTE;
    await context.service.tick(context.clock.now);
    expect(context.state(server.serverId)).toMatchObject({ desired_state: "running", observed_state: "running" });
    expect(leases()).toHaveLength(0);

    // Use near the end of the boat lease moves the lease.
    context.clock.now += 33 * MINUTE;
    await context.service.reportActivity(sessionToken, server.serverId, { inUse: true });
    expect(leases().map((call) => [call.method, call.body])).toEqual([["PATCH", { ttlSeconds: LEASE }]]);
    await context.service.reportActivity(sessionToken, server.serverId, { inUse: true });
    expect(leases()).toHaveLength(1);

    context.clock.now += 15 * MINUTE;
    await context.service.tick(context.clock.now);
    expect(context.state(server.serverId)).toMatchObject({ desired_state: "idle", observed_state: "stopping" });
    expect(calls("/sandboxes/bx_1/stop")).toHaveLength(1);
    context.clock.now += MINUTE;
    await context.service.handleWebhook(context.boatWebhook("sandbox.archived", "archived"));
    await context.service.reportActivity(sessionToken, server.serverId, { inUse: true });
    await context.service.tick(context.clock.now + 5 * MINUTE);
    expect(context.state(server.serverId)).toMatchObject({ desired_state: "idle", observed_state: "stopped" });
    expect(calls("/sandboxes/bx_1/resume")).toHaveLength(0);
    expect(context.boatCalls.some((call) => call.method === "DELETE")).toBe(false);

    await expect(context.service.wake(owner, server.serverId)).resolves.toMatchObject({ state: "waking" });
    expect(calls("/sandboxes/bx_1/resume").map((call) => call.body)).toEqual([{ ttlSeconds: LEASE }]);
    expect(context.state(server.serverId)).toMatchObject({ desired_state: "running", last_wake_reason: "message" });
  });

  it("starts an idle server before its next routine run, once for each reported run", async () => {
    const context = await setup();
    const server = await createRunningServer(context);
    const { sessionToken } = await context.service.redeemClaim(context.claims[0]);
    const resumes = () => context.boatCalls.filter((call) => call.path === "/sandboxes/bx_1/resume");
    const runAt = context.clock.now + 40 * MINUTE;

    // A report with no use keeps the idle time, and a run that is due now is not stored.
    await context.service.reportActivity(sessionToken, server.serverId, { inUse: false, nextRunAt: context.clock.now });
    expect(context.state(server.serverId)).toMatchObject({ next_run_at: null });
    await context.service.reportActivity(sessionToken, server.serverId, { inUse: false, nextRunAt: runAt });
    context.clock.now += 16 * MINUTE;
    await context.service.tick(context.clock.now);
    expect(context.state(server.serverId)).toMatchObject({ desired_state: "idle", next_run_at: runAt });
    context.clock.now += MINUTE;
    await context.service.handleWebhook(context.boatWebhook("sandbox.archived", "archived"));

    context.clock.now = runAt - 11 * MINUTE;
    await context.service.tick(context.clock.now);
    expect(resumes()).toHaveLength(0);
    context.clock.now = runAt - 9 * MINUTE;
    await context.service.tick(context.clock.now);
    await context.service.tick(context.clock.now);
    expect(resumes()).toHaveLength(1);
    expect(context.state(server.serverId)).toMatchObject({
      desired_state: "running",
      observed_state: "waking",
      last_wake_reason: "schedule",
      next_run_at: null,
    });

    // A server with no use does not stop just before its next run.
    await context.service.handleWebhook(context.boatWebhook("sandbox.ready", "ready"));
    const nextRunAt = context.clock.now + 20 * MINUTE;
    await context.service.reportActivity(sessionToken, server.serverId, { inUse: false, nextRunAt });
    context.clock.now += 16 * MINUTE;
    await context.service.tick(context.clock.now);
    expect(context.state(server.serverId)).toMatchObject({ desired_state: "running", observed_state: "running" });

    // A report with no body is from an older server: it is use and keeps the stored run.
    await context.service.reportActivity(sessionToken, server.serverId, { inUse: true });
    expect(context.state(server.serverId)).toMatchObject({ next_run_at: nextRunAt });
  });
});

/** The Stripe API calls that hosted servers make. Customer `cus_1` belongs to the owner. */
class FakeStripe {
  readonly subscriptions = new Map<string, unknown>();
  /** Checkout session ID → status. */
  readonly sessions = new Map<string, string>();
  /** Checkout session ID → the subscription that its payment started. */
  readonly sessionSubscriptions = new Map<string, string>();
  readonly checkouts: URLSearchParams[] = [];
  readonly cancelled: string[] = [];
  customersCreated = 0;
  failCancel = false;

  async fetch(input: string, init: RequestInit): Promise<Response> {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const body = new URLSearchParams(typeof init.body === "string" ? init.body : "");
    if (method === "GET" && url.pathname === "/v1/prices") return Response.json({ data: prices() });
    if (method === "POST" && url.pathname === "/v1/customers") {
      this.customersCreated += 1;
      return Response.json({ id: `cus_${this.customersCreated}` });
    }
    const customer = /^\/v1\/customers\/([^/]+)$/u.exec(url.pathname)?.[1];
    if (method === "GET" && customer) return Response.json({ id: customer });
    if (method === "POST" && url.pathname === "/v1/checkout/sessions") {
      this.checkouts.push(body);
      const id = `cs_${this.checkouts.length}`;
      this.sessions.set(id, "open");
      return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}`, status: "open" });
    }
    const expire = /^\/v1\/checkout\/sessions\/([^/]+)\/expire$/u.exec(url.pathname)?.[1];
    if (method === "POST" && expire) {
      if (this.sessions.get(expire) !== "open")
        return Response.json({ error: { type: "invalid_request_error" } }, { status: 400 });
      this.sessions.set(expire, "expired");
      return Response.json({ id: expire, url: null, status: "expired" });
    }
    const session = /^\/v1\/checkout\/sessions\/([^/]+)$/u.exec(url.pathname)?.[1];
    if (method === "GET" && session) {
      return Response.json({
        id: session,
        url: null,
        status: this.sessions.get(session) ?? null,
        subscription: this.sessionSubscriptions.get(session) ?? null,
      });
    }
    const subscriptionId = /^\/v1\/subscriptions\/([^/]+)$/u.exec(url.pathname)?.[1];
    const stored = subscriptionId ? this.subscriptions.get(subscriptionId) : undefined;
    if (method === "GET" && subscriptionId) {
      return stored
        ? Response.json(stored)
        : Response.json({ error: { type: "invalid_request_error" } }, { status: 404 });
    }
    if (method === "DELETE" && subscriptionId && isDynamicRecord(stored)) {
      if (this.failCancel) return Response.json({ error: { type: "api_error" } }, { status: 500 });
      this.cancelled.push(subscriptionId);
      const canceled = { ...stored, status: "canceled" };
      this.subscriptions.set(subscriptionId, canceled);
      return Response.json(canceled);
    }
    throw new Error(`Unexpected Stripe request ${method} ${url.pathname}`);
  }
}

function prices() {
  return BILLING_PLAN_IDS.flatMap((plan) =>
    BILLING_INTERVALS.map((interval) => ({
      id: `price_${plan}_${interval}`,
      lookup_key: `openbot_${plan}_${interval}`,
      currency: "eur",
      unit_amount: 2_000,
      currency_options: Object.fromEntries(BILLING_CURRENCIES.map((currency) => [currency, { unit_amount: 2_000 }])),
    })),
  );
}

function subscription(
  id: string,
  status: string,
  serverId: string,
  customer: string,
  now: number,
  plan: BillingPlanId,
) {
  return {
    id,
    customer,
    status,
    currency: "eur",
    cancel_at_period_end: false,
    metadata: { openbot_user_id: owner.id, openbot_server_id: serverId },
    items: {
      data: [
        {
          current_period_end: Math.floor(now / 1_000) + 30 * 86_400,
          price: {
            id: `price_${plan}_month`,
            lookup_key: `openbot_${plan}_month`,
            currency: "eur",
            unit_amount: 2_000,
          },
        },
      ],
    },
  };
}
