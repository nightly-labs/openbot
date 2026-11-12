// Runs the real account server hosted-server service and the pool snapshot on a migrated SQLite
// database, with the real billing service and a Stripe that answers the subscription reads. The operator
// runs a pool of machines (`operator_hosts`) in more than one location. A server on a machine of the
// operator keeps its data for 30 days after its plan ends, as the Terms say. Then the cron deletes it
// when Stripe confirms that the subscription is cancelled, and the operator reinstalls the machine for the
// next customer. A renewal in the 30 days keeps the server. An open subscription that Stripe still
// retries (`unpaid`) keeps it too. A server on boat is never deleted by this rule. A plan that ended
// under the Worker from before migration 0053 gets the date of the first check. The snapshot of each
// minute counts the machines of each location and product by state, and when they are free; the OpenPanel
// event keeps only safe values.
//
// Run: bun run test:hosted-operator-pool
// It writes .openbot-build/hosted-operator-pool-e2e/report.json and exits non-zero on a failure.
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { ACCOUNT_ANALYTICS_SCHEMA_VERSION, createAccountAnalytics } from "../src/server/account-analytics";
import { BillingService } from "../src/server/billing-service";
import { type HostedPoolGroup, readHostedPool } from "../src/server/hosted-pool-snapshot";
import { HostedServerService, OPERATOR_HOST_DATA_KEPT_MS } from "../src/server/hosted-server-service";
import { SIGNAL_ENTRY_CRON } from "../src/server/signal-entry-failover";
import { createWorkerHandler } from "../src/server/worker-handler";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "hosted-operator-pool-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const OWNER = { id: "owner", email: "owner@example.test" };
const MINUTE = 60_000;
/** The other cron of the production Worker (`wrangler.jsonc`). */
const FIVE_MINUTE_CRON = "*/5 * * * *";
const DAY = 24 * 60 * MINUTE;
const FAR = 400 * DAY;

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

async function run() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  const t0 = Date.UTC(2026, 10, 12, 12);
  const clock = { now: t0 };
  database
    .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
    .run(OWNER.id, `email:${OWNER.email}`, OWNER.email);

  // The pool: four machines in Amsterdam, one in Washington, one in Sydney, and one that left the pool.
  const machine = database.prepare(
    "INSERT INTO operator_hosts(host_id, location, product, added_at, removed_at) VALUES (?, ?, ?, 1, ?)",
  );
  for (const [id, location, product, removedAt] of [
    ["leaseweb:101", "AMS-01", "VPS02", null],
    ["leaseweb:102", "AMS-01", "VPS02", null],
    ["leaseweb:103", "AMS-01", "VPS02", null],
    ["leaseweb:104", "AMS-01", "VPS02", null],
    ["leaseweb:105", "WDC-02", "VPS02", null],
    ["leaseweb:106", "SYD-12", "VPS03", null],
    ["leaseweb:107", "AMS-01", "VPS02", 5],
  ] as const) {
    machine.run(id, location, product, removedAt);
  }

  const insert = database.prepare(
    `INSERT INTO hosted_servers(
       server_id, owner_user_id, name, provider_sandbox_id, provider_template, operator_host, retired_sandbox_id,
       size, plan, billing_interval, currency, desired_state, observed_state, observed_error, idempotency_key,
       last_active_at, plan_ended_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'tpl_1', ?, ?, 'default', 'standard', 'month', 'eur', ?, ?, ?, ?, ?, ?, 1, ?)`,
  );
  const subscribe = database.prepare(
    `INSERT INTO billing_subscriptions(
       stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, amount, status,
       current_period_end, cancel_at_period_end, updated_at
     ) VALUES (?, ?, 'cus_1', ?, 'standard', 'month', 'eur', 2900, ?, ?, ?, ?)`,
  );
  const server = (
    id: string,
    state: {
      machine?: string;
      sandboxId?: string;
      desired?: string;
      observed?: string;
      error?: string | null;
      planEndedAt?: number | null;
      status: string;
      periodEnd?: number;
      cancelAtPeriodEnd?: boolean;
    },
  ) => {
    const desired = state.desired ?? "running";
    insert.run(
      id,
      OWNER.id,
      `Server ${id}`,
      state.sandboxId ?? null,
      state.machine ?? null,
      state.machine ? `bx_old_${id}` : null,
      desired,
      state.observed ?? desired,
      state.error ?? null,
      `key-${id}`,
      t0,
      state.planEndedAt ?? null,
      t0 - 20 * MINUTE,
    );
    subscribe.run(
      `sub_${id}`,
      OWNER.id,
      id,
      state.status,
      state.periodEnd ?? t0 + FAR,
      state.cancelAtPeriodEnd ? 1 : 0,
      t0,
    );
  };
  // 101: in use. 102: the owner cancelled at the end of the period, in 60 days. 103: the plan ended.
  server("active", { machine: "leaseweb:101", status: "active" });
  server("cancelling", {
    machine: "leaseweb:102",
    status: "active",
    periodEnd: t0 + 60 * DAY,
    cancelAtPeriodEnd: true,
  });
  server("ended", { machine: "leaseweb:103", status: "canceled" });
  // 104 is free. 105: the plan ended under the Worker before migration 0053, so it has no date.
  server("old-ended", {
    machine: "leaseweb:105",
    desired: "stopped",
    observed: "stopped",
    error: "plan_ended",
    status: "canceled",
  });
  // 106: Stripe still retries the payment.
  server("unpaid", { machine: "leaseweb:106", status: "unpaid" });
  // 107 left the pool, and its server is deleted: the operator must still reinstall it.
  server("gone", { machine: "leaseweb:107", desired: "deleted", observed: "deleted", status: "canceled" });
  // A server on boat whose plan ended 40 days ago, and a server whose owner pays again in the 30 days.
  server("boat-ended", {
    sandboxId: "bx_boat_ended",
    desired: "stopped",
    observed: "stopped",
    error: "plan_ended",
    planEndedAt: t0 - 40 * DAY,
    status: "canceled",
  });
  machine.run("leaseweb:108", "AMS-01", "VPS02", null);
  server("renewed", { machine: "leaseweb:108", status: "canceled" });

  const boatCalls: string[] = [];
  const boatFetch = async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname.replace("/api/v1", "");
    const method = init.method ?? "GET";
    boatCalls.push(`${method} ${path}`);
    if (method === "GET") {
      const sandboxId = decodeURIComponent(path.split("/")[2] ?? "");
      return Response.json({ ok: true, sandbox: { id: sandboxId, state: "archived" } });
    }
    return Response.json({ ok: true });
  };
  const stripeCalls: string[] = [];
  // The close of an open renewal Checkout page fails until a check sets this.
  const checkout = { closes: false };
  const billing = new BillingService({
    database: sqliteD1(database),
    secretKey: "sk_test_none",
    webhookSecret: null,
    fetch: async (input, init) => {
      const url = new URL(input);
      stripeCalls.push(`${init.method ?? "GET"} ${url.pathname}`);
      if (url.pathname.startsWith("/v1/checkout/sessions/")) {
        return checkout.closes
          ? Response.json({ id: "cs_open", url: null, status: "expired", metadata: {}, subscription: null })
          : Response.json({ error: { type: "api_error" } }, { status: 500 });
      }
      const id = decodeURIComponent(url.pathname.replace("/v1/subscriptions/", ""));
      const stored = database
        .prepare("SELECT server_id, status FROM billing_subscriptions WHERE stripe_subscription_id = ?")
        .get(id);
      if ((init.method ?? "GET") !== "GET" || !stored) {
        return Response.json({ error: { type: "api_error" } }, { status: 500 });
      }
      return Response.json({
        id,
        customer: "cus_1",
        status: stored.status,
        currency: "eur",
        cancel_at_period_end: false,
        metadata: { openbot_user_id: OWNER.id, openbot_server_id: String(stored.server_id) },
        items: {
          data: [
            {
              id: `si_${id}`,
              current_period_end: Math.floor((t0 - DAY) / 1000),
              price: {
                id: "price_standard",
                lookup_key: "openbot_standard_month",
                metadata: {},
                currency: "eur",
                unit_amount: 2900,
              },
            },
          ],
        },
      });
    },
    now: () => clock.now,
  });
  const removed: string[] = [];
  const work: Promise<void>[] = [];
  const service = new HostedServerService(
    {
      DB: sqliteD1(database),
      HOSTED_SERVERS_ENABLED: "true",
      BOAT_API_KEY: "boat-key",
      BOAT_WEBHOOK_SECRET: "webhook-secret",
      HOSTED_SERVER_TEMPLATE: "tpl_1",
      REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ kty: "EC", crv: "P-256", d: "private-value-of-the-test-key" }),
    },
    {
      fetch: boatFetch,
      now: () => clock.now,
      billing,
      removeHost: (_ownerUserId, hostId) =>
        Effect.sync(() => {
          removed.push(hostId);
        }),
      schedule: (effect) => work.push(Effect.runPromise(effect)),
    },
  );
  const tick = async (at: number) => {
    clock.now = at;
    const result = await Effect.runPromise(service.tick(at));
    await Promise.all(work.splice(0));
    return result;
  };
  const row = (serverId: string) =>
    database
      .prepare(
        "SELECT desired_state, observed_state, observed_error, operator_host, plan_ended_at FROM hosted_servers WHERE server_id = ?",
      )
      .get(serverId);
  const pool = async (at: number) => {
    const groups = await Effect.runPromise(readHostedPool(sqliteD1(database), at));
    const find = (location: string, product: string) =>
      groups.find((entry) => entry.location === location && entry.product === product);
    return { groups, find };
  };
  const counts = (group: HostedPoolGroup | undefined) =>
    group && {
      machines: group.machines,
      free: group.free,
      to_reinstall: group.to_reinstall,
      plan_ended: group.plan_ended,
      cancel_scheduled: group.cancel_scheduled,
      in_use: group.in_use,
      free_in_7d: group.free_in_7d,
      free_in_30d: group.free_in_30d,
    };
  const same = (group: HostedPoolGroup | undefined, expected: ReturnType<typeof counts>) =>
    JSON.stringify(counts(group)) === JSON.stringify(expected);

  // An empty pool sends no event.
  const empty = new DatabaseSync(":memory:");
  for (const name of readdirSync(MIGRATIONS).sort()) empty.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  const emptyGroups = await Effect.runPromise(readHostedPool(sqliteD1(empty), t0));
  check("an empty pool has no group", emptyGroups.length === 0, emptyGroups);
  empty.close();

  // Before the first check: the plans of `ended` and `unpaid` ended, but the Worker did not see it yet.
  const before = await pool(t0);
  check(
    "the snapshot counts each machine of a location and product by state",
    same(before.find("AMS-01", "VPS02"), {
      machines: 5,
      free: 1,
      to_reinstall: 0,
      plan_ended: 0,
      cancel_scheduled: 1,
      in_use: 3,
      free_in_7d: 1,
      free_in_30d: 1,
    }) &&
      same(before.find("WDC-02", "VPS02"), {
        machines: 1,
        free: 0,
        to_reinstall: 0,
        plan_ended: 1,
        cancel_scheduled: 0,
        in_use: 0,
        free_in_7d: 0,
        free_in_30d: 1,
      }) &&
      same(before.find("unknown", "unknown"), {
        machines: 1,
        free: 0,
        to_reinstall: 1,
        plan_ended: 0,
        cancel_scheduled: 0,
        in_use: 0,
        free_in_7d: 1,
        free_in_30d: 1,
      }) &&
      before.find("all", "all")?.machines === 8 &&
      before.groups.length === 5,
    before.groups,
  );

  await tick(t0);
  check(
    "the first check ends the plans, dates each end, and dates an end from before the deploy",
    row("ended")?.desired_state === "stopped" &&
      row("ended")?.plan_ended_at === t0 &&
      row("unpaid")?.desired_state === "stopped" &&
      row("unpaid")?.plan_ended_at === t0 &&
      row("renewed")?.plan_ended_at === t0 &&
      row("old-ended")?.plan_ended_at === t0 &&
      row("boat-ended")?.plan_ended_at === t0 - 40 * DAY,
    {
      ended: row("ended"),
      unpaid: row("unpaid"),
      renewed: row("renewed"),
      oldEnded: row("old-ended"),
      boatEnded: row("boat-ended"),
    },
  );
  const afterEnd = await pool(t0 + 25 * DAY);
  check(
    "25 days after the end, the ended plans are free in 7 days and the unpaid one has no date",
    same(afterEnd.find("AMS-01", "VPS02"), {
      machines: 5,
      free: 1,
      to_reinstall: 0,
      plan_ended: 2,
      cancel_scheduled: 1,
      in_use: 1,
      free_in_7d: 3,
      free_in_30d: 3,
    }) &&
      same(afterEnd.find("SYD-12", "VPS03"), {
        machines: 1,
        free: 0,
        to_reinstall: 0,
        plan_ended: 1,
        cancel_scheduled: 0,
        in_use: 0,
        free_in_7d: 0,
        free_in_30d: 0,
      }),
    afterEnd.groups,
  );
  // The owner of `renewed` pays again 10 days after the end.
  database
    .prepare("UPDATE billing_subscriptions SET status = 'active', updated_at = ? WHERE server_id = 'renewed'")
    .run(t0 + 10 * DAY);
  await tick(t0 + 10 * DAY);
  check(
    "a renewal in the 30 days gives the server its plan again",
    row("renewed")?.desired_state === "running",
    row("renewed"),
  );

  const callsBefore = { boat: boatCalls.length, stripe: stripeCalls.length };
  await tick(t0 + OPERATOR_HOST_DATA_KEPT_MS - MINUTE);
  check(
    "one minute before the 30 days, no server is deleted and Stripe gets no subscription read",
    row("ended")?.desired_state === "stopped" &&
      row("old-ended")?.desired_state === "stopped" &&
      !stripeCalls.slice(callsBefore.stripe).some((call) => call.includes("sub_ended")),
    { ended: row("ended"), stripe: stripeCalls.slice(callsBefore.stripe) },
  );

  await tick(t0 + OPERATOR_HOST_DATA_KEPT_MS);
  check(
    "after 30 days, the cron deletes each moved server whose subscription Stripe cancelled",
    row("ended")?.desired_state === "deleted" &&
      row("ended")?.observed_state === "deleted" &&
      row("ended")?.operator_host === "leaseweb:103" &&
      row("old-ended")?.observed_state === "deleted" &&
      stripeCalls.includes("GET /v1/subscriptions/sub_ended") &&
      boatCalls.includes("DELETE /sandboxes/bx_old_ended") &&
      removed.includes("ended") &&
      removed.includes("old-ended"),
    { ended: row("ended"), oldEnded: row("old-ended"), removed, boat: boatCalls.slice(callsBefore.boat) },
  );
  check(
    "an unpaid plan, a renewed plan and a server on boat keep their servers",
    row("unpaid")?.desired_state === "stopped" &&
      row("renewed")?.desired_state === "running" &&
      row("boat-ended")?.desired_state === "stopped" &&
      row("active")?.desired_state === "running" &&
      !removed.includes("unpaid") &&
      !removed.includes("boat-ended") &&
      !boatCalls.includes("DELETE /sandboxes/bx_boat_ended"),
    { unpaid: row("unpaid"), renewed: row("renewed"), boatEnded: row("boat-ended"), removed },
  );

  const afterDelete = await pool(t0 + OPERATOR_HOST_DATA_KEPT_MS);
  check(
    "a deleted server leaves its machine to reinstall",
    afterDelete.find("AMS-01", "VPS02")?.to_reinstall === 1 && afterDelete.find("WDC-02", "VPS02")?.to_reinstall === 1,
    afterDelete.groups,
  );
  // The operator reinstalls the machines and gives them back to the pool (`leaseweb-pool.ts sync`).
  database
    .prepare(
      "UPDATE hosted_servers SET operator_host = NULL WHERE operator_host IS NOT NULL AND observed_state = 'deleted'",
    )
    .run();
  const reinstalled = await pool(t0 + OPERATOR_HOST_DATA_KEPT_MS);
  check(
    "a reinstalled machine is free, and a machine that left the pool is no longer counted",
    reinstalled.find("AMS-01", "VPS02")?.free === 2 &&
      reinstalled.find("WDC-02", "VPS02")?.free === 1 &&
      reinstalled.find("unknown", "unknown") === undefined &&
      reinstalled.find("all", "all")?.machines === 7,
    reinstalled.groups,
  );
  // The plan that ends in 60 days frees its machine 30 days after that: in the 30 days from day 61.
  const later = await pool(t0 + 61 * DAY);
  check(
    "a plan cancelled at the end of its period is free 30 days after the period ends",
    later.find("AMS-01", "VPS02")?.free_in_30d === 3 && later.find("AMS-01", "VPS02")?.free_in_7d === 2,
    later.groups,
  );

  // The OpenPanel event of each group, and a group with a value that is not of the pool.
  const bodies: unknown[] = [];
  const sends: Effect.Effect<void>[] = [];
  const analytics = createAccountAnalytics({
    clientId: "client",
    clientSecret: "secret",
    fetch: async (_input, init) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 202 });
    },
    schedule: (send) => sends.push(send),
    database: sqliteD1(database),
  });
  for (const group of reinstalled.groups) analytics.track(null, { name: "hosted_pool_snapshot", group });
  const total = reinstalled.find("all", "all");
  if (total) {
    analytics.track(null, { name: "hosted_pool_snapshot", group: { ...total, location: "owner@example.test" } });
    analytics.track(null, { name: "hosted_pool_snapshot", group: { ...total, free: 1.5 } });
  }
  await Effect.runPromise(Effect.all(sends, { concurrency: "unbounded", discard: true }));
  const sent = JSON.stringify(bodies);
  const first = bodies[0];
  check(
    "each group is one event with no account, and a bad value drops the event",
    bodies.length === reinstalled.groups.length &&
      !sent.includes("example.test") &&
      !sent.includes("profileId") &&
      typeof first === "object" &&
      first !== null &&
      JSON.stringify(first).includes(`"event_schema_version":${ACCOUNT_ANALYTICS_SCHEMA_VERSION}`) &&
      JSON.stringify(first).includes('"name":"hosted_pool_snapshot"'),
    bodies,
  );

  // The each-minute cron of the Worker sends the snapshot at each minute; the five-minute cron sends none.
  const scheduledAt = t0 + OPERATOR_HOST_DATA_KEPT_MS + 7 * MINUTE;
  const snapshots = await scheduledSnapshots(database, scheduledAt, SIGNAL_ENTRY_CRON);
  const expected = await pool(scheduledAt);
  check(
    "the each-minute cron sends one snapshot for each group at a minute that is not on the hour",
    snapshots.length === expected.groups.length &&
      expected.groups.every((group) =>
        snapshots.some((body) =>
          Object.entries(group).every(([key, value]) => body.includes(`"${key}":${JSON.stringify(value)}`)),
        ),
      ),
    { snapshots, expected: expected.groups },
  );
  const fiveMinuteRun = await scheduledSnapshots(database, scheduledAt + 3 * MINUTE, FIVE_MINUTE_CRON);
  check("the five-minute cron sends no snapshot", fiveMinuteRun.length === 0, fiveMinuteRun);

  // On reinstalled machines: a plan whose renewal page is still open, and a first payment that never came.
  const late = t0 + 40 * DAY;
  const ended = { desired: "stopped", observed: "stopped", error: "plan_ended", planEndedAt: late - 31 * DAY };
  server("checkout-open", { ...ended, machine: "leaseweb:104", status: "canceled" });
  database.prepare("UPDATE hosted_servers SET checkout_session_id = 'cs_open' WHERE server_id = 'checkout-open'").run();
  server("never-paid", { ...ended, machine: "leaseweb:105", status: "incomplete_expired" });
  await tick(late);
  check(
    "a renewal page that does not close keeps the server, and a first payment that never came ends the plan",
    row("checkout-open")?.desired_state === "stopped" &&
      stripeCalls.includes("POST /v1/checkout/sessions/cs_open/expire") &&
      row("never-paid")?.observed_state === "deleted" &&
      removed.includes("never-paid"),
    { checkoutOpen: row("checkout-open"), neverPaid: row("never-paid"), removed },
  );
  checkout.closes = true;
  await tick(late + 5 * MINUTE);
  check(
    "the next check closes the renewal page and deletes the server",
    row("checkout-open")?.observed_state === "deleted" && removed.includes("checkout-open"),
    row("checkout-open"),
  );
}

/** The `hosted_pool_snapshot` request bodies that one run of the Worker cron sends to OpenPanel. */
async function scheduledSnapshots(database: DatabaseSync, at: number, cron: string): Promise<string[]> {
  const snapshots: string[] = [];
  const originalFetch = globalThis.fetch;
  const routedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url !== "https://analytics.openbot.run/api/track") return new Response(null, { status: 404 });
    const body = String(init?.body);
    if (body.includes('"name":"hosted_pool_snapshot"')) snapshots.push(body);
    return new Response(null, { status: 202 });
  };
  globalThis.fetch = Object.assign(routedFetch, { preconnect: originalFetch.preconnect });
  try {
    await createWorkerHandler(() => new Response(null, { status: 404 })).scheduled(
      { scheduledTime: at, cron },
      { DB: sqliteD1(database), OPENPANEL_CLIENT_ID: "client", OPENPANEL_CLIENT_SECRET: "secret" },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  return snapshots;
}

await run().catch((error: unknown) => {
  check("the E2E ran to its end", false, error instanceof Error ? error.stack : String(error));
});
await mkdir(OUT, { recursive: true });
const failed = checks.filter((entry) => !entry.passed);
await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed: failed.length === 0, checks }, null, 2)}\n`);
for (const entry of checks) console.info(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}`);
if (failed.length > 0) {
  for (const entry of failed) console.error(entry.name, JSON.stringify(entry.detail, null, 2));
  process.exit(1);
}
