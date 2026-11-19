import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { licensePeriodAmount } from "@openbot/contracts/license";
import { Effect } from "effect";
import { createHostedBilling } from "../src/server/hosted-billing";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "purchase-alert-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const ALERT_URL = "https://alerts.example/webhook";
const WEBHOOK_SECRET = "whsec_test";
const SERVER_BUYER = { id: "server-buyer", email: "server.buyer@example.test" };
const LICENSE_BUYER = { id: "license-buyer", email: "license.buyer@example.test" };
const SERVER_ID = "0b0f6f0e-6f0f-4a55-9a51-2f5a4e7b8c01";

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  for (const user of [SERVER_BUYER, LICENSE_BUYER]) {
    database
      .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
      .run(user.id, `email:${user.email}`, user.email);
  }
  return database;
}

function subscriptions(periodEnd: number) {
  return new Map<string, object>(
    Object.entries({
      sub_server: {
        id: "sub_server",
        customer: "cus_server",
        status: "active",
        currency: "usd",
        cancel_at_period_end: false,
        metadata: { openbot_user_id: SERVER_BUYER.id, openbot_server_id: SERVER_ID },
        items: {
          data: [
            {
              id: "si_server",
              current_period_end: periodEnd,
              price: {
                id: "price_standard",
                lookup_key: "openbot_standard_month",
                metadata: {},
                currency: "usd",
                unit_amount: 3500,
              },
            },
          ],
        },
      },
      sub_license: {
        id: "sub_license",
        customer: "cus_license",
        status: "active",
        currency: "pln",
        cancel_at_period_end: false,
        metadata: { openbot_user_id: LICENSE_BUYER.id },
        items: {
          data: [
            {
              id: "si_license",
              current_period_end: periodEnd,
              quantity: 7,
              price: {
                id: "price_license_year",
                lookup_key: "openbot_license_year",
                metadata: {},
                currency: "pln",
                unit_amount: null,
              },
            },
          ],
        },
      },
    }),
  );
}

async function run(alertUrl: string | undefined) {
  const database = migratedDatabase();
  const clock = { now: Date.UTC(2026, 10, 15, 12) };
  const stored = subscriptions(Math.floor(clock.now / 1000) + 30 * 24 * 3600);
  const alerts: string[] = [];
  const work: Promise<void>[] = [];
  const gate: { reads: number; waiting: (() => void)[] } = { reads: 0, waiting: [] };
  const { billing } = createHostedBilling(
    {
      DB: sqliteD1(database),
      STRIPE_SECRET_KEY: "sk_test_none",
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      ...(alertUrl ? { HOSTED_POOL_ALERT_WEBHOOK_URL: alertUrl } : {}),
    },
    {
      removeHost: () => Effect.void,
      planChanged: () => Effect.void,
      licenseChanged: () => Effect.void,
      schedule: (effect) => work.push(Effect.runPromise(effect)),
      fetch: async (input, init) => {
        if (input === ALERT_URL) {
          alerts.push(String(JSON.parse(String(init.body)).content));
          return new Response(null, { status: 204 });
        }
        const url = new URL(input);
        const subscription = stored.get(decodeURIComponent(url.pathname.replace("/v1/subscriptions/", "")));
        if ((init.method ?? "GET") === "GET" && subscription) {
          if (gate.reads > 0) {
            const read = Promise.withResolvers<void>();
            gate.waiting.push(read.resolve);
            if (gate.waiting.length === gate.reads) {
              gate.reads = 0;
              for (const release of gate.waiting.splice(0)) release();
            }
            await read.promise;
          }
          return Response.json(subscription);
        }
        return Response.json({ error: { type: "api_error" } }, { status: 500 });
      },
    },
  );
  if (!billing) throw new Error("Billing is off.");
  let sent = 0;
  const deliver = async (
    type: string,
    object: { id: string; subscription?: string; amount_paid?: number; currency?: string },
    eventId?: string,
  ) => {
    sent += 1;
    const created = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ id: eventId ?? `evt_${sent}`, type, created, data: { object } });
    const signature = createHmac("sha256", WEBHOOK_SECRET).update(`${created}.${payload}`).digest("hex");
    await Effect.runPromise(billing.handleWebhook(payload, `t=${created},v1=${signature}`));
    await Promise.all(work.splice(0));
  };
  const change = (
    id: string,
    patch: { cancel_at_period_end?: boolean; cancel_at?: number; canceled_at?: number; status?: string },
  ) => stored.set(id, { ...stored.get(id), ...patch });
  const deliverTogether = (events: Parameters<typeof deliver>[]) => {
    gate.reads = events.length;
    return Promise.all(events.map((event) => deliver(...event)));
  };
  return { database, alerts, deliver, deliverTogether, change };
}

const FIRST_CANCEL = 1_790_000_000;
const SECOND_CANCEL = 1_790_000_100;
const LICENSE_CANCEL = 1_790_000_200;

async function purchasesAlertTheOperator() {
  const { database, alerts, deliver, deliverTogether, change } = await run(ALERT_URL);

  await deliver("customer.subscription.created", { id: "sub_server" }, "evt_server_created");
  const serverText = `🆕 **New** server · \`${SERVER_BUYER.email}\` · standard · $35/mo`;
  check(
    "a new server plan sends one message with the email, the plan, the amount and the period",
    alerts.length === 1 && alerts[0] === serverText,
    alerts,
  );

  await deliver("customer.subscription.created", { id: "sub_server" }, "evt_server_created");
  await deliver("customer.subscription.updated", { id: "sub_server" });
  await deliver("invoice.paid", { id: "in_1", subscription: "sub_server", amount_paid: 3500, currency: "usd" });
  check("a repeated event, an update and a renewal of that plan send no message", alerts.length === 1, alerts);

  await deliver("customer.subscription.created", { id: "sub_license" });
  const amount = new Intl.NumberFormat("en", {
    style: "currency",
    currency: "PLN",
    trailingZeroDisplay: "stripIfInteger",
  })
    .format(licensePeriodAmount({ tier: "team", interval: "year", bundle: false }, 7, "pln") / 100)
    .replace("\u00a0", " ");
  const licenseText = `🆕 **New** license · \`${LICENSE_BUYER.email}\` · team · 7 users · ${amount}/yr`;
  check(
    "a new license sends one message with the email, the tier, the users, the amount and the period",
    alerts.length === 2 && alerts[1] === licenseText,
    alerts,
  );

  await deliver("customer.subscription.updated", { id: "sub_license" });
  check("a second event of the license sends no message", alerts.length === 2, alerts);

  const serverTerms = `server · \`${SERVER_BUYER.email}\` · standard · $35/mo`;
  change("sub_server", { cancel_at_period_end: true, canceled_at: FIRST_CANCEL });
  await deliverTogether([
    ["customer.subscription.updated", { id: "sub_server" }],
    ["customer.subscription.updated", { id: "sub_server" }],
  ]);
  check(
    "a cancelled renewal of a server plan sends one message with the last day, also for two events at the same time",
    alerts.length === 3 && alerts[2] === `🚪 **Cancelled** ${serverTerms} · ends 2026-12-15`,
    alerts,
  );
  await deliver("customer.subscription.updated", { id: "sub_server" });
  check("a second event of the cancelled renewal sends no message", alerts.length === 3, alerts);

  change("sub_server", { cancel_at_period_end: false });
  await deliver("customer.subscription.updated", { id: "sub_server" });
  check(
    "a resumed renewal sends one message",
    alerts.length === 4 && alerts[3] === `🔄 **Resumed** ${serverTerms}`,
    alerts,
  );

  change("sub_server", { cancel_at_period_end: true, canceled_at: SECOND_CANCEL });
  await deliver("customer.subscription.updated", { id: "sub_server" });
  change("sub_server", { cancel_at_period_end: false });
  await deliver("customer.subscription.updated", { id: "sub_server" });
  check(
    "a second cancel and resume of the same renewal each send one message again",
    alerts.length === 6 &&
      alerts[4] === `🚪 **Cancelled** ${serverTerms} · ends 2026-12-15` &&
      alerts[5] === `🔄 **Resumed** ${serverTerms}`,
    alerts,
  );

  change("sub_server", { status: "canceled" });
  await deliver("customer.subscription.deleted", { id: "sub_server" });
  await deliver("customer.subscription.updated", { id: "sub_server" });
  check(
    "an ended server plan sends one message with the reason",
    alerts.length === 7 && alerts[6] === `⛔ **Ended** ${serverTerms} · cancelled`,
    alerts,
  );

  const licenseTerms = `license · \`${LICENSE_BUYER.email}\` · team · 7 users · ${amount}/yr`;
  change("sub_license", { cancel_at: Date.UTC(2027, 0, 31) / 1000, canceled_at: LICENSE_CANCEL });
  await deliver("customer.subscription.updated", { id: "sub_license" });
  change("sub_license", { status: "past_due" });
  await deliver("customer.subscription.updated", { id: "sub_license" });
  change("sub_license", { status: "canceled" });
  await deliver("customer.subscription.deleted", { id: "sub_license" });
  check(
    "a license sends one message for its cancel date and one for its end after a failed payment",
    alerts.length === 9 &&
      alerts[7] === `🚪 **Cancelled** ${licenseTerms} · ends 2027-01-31` &&
      alerts[8] === `⛔ **Ended** ${licenseTerms} · not paid`,
    alerts,
  );

  const claims = database
    .prepare("SELECT event_id FROM billing_webhook_events WHERE type = 'purchase' ORDER BY event_id")
    .all();
  check(
    "each subscription has one start claim, one end claim, and one claim for each cancel request",
    claims.map((claim) => claim.event_id).join() ===
      [
        "openbot_purchase:sub_license",
        "openbot_purchase:sub_server",
        `openbot_purchase_cancel:sub_license:${LICENSE_CANCEL}`,
        `openbot_purchase_cancel:sub_server:${FIRST_CANCEL}`,
        `openbot_purchase_cancel:sub_server:${SECOND_CANCEL}`,
        "openbot_purchase_end:sub_license",
        "openbot_purchase_end:sub_server",
      ].join(),
    claims,
  );
}

async function noWebhookUrlSendsNothing() {
  const { database, alerts, deliver } = await run(undefined);
  await deliver("customer.subscription.created", { id: "sub_server" });
  const plan = database
    .prepare("SELECT plan, status FROM billing_subscriptions WHERE stripe_subscription_id = 'sub_server'")
    .get();
  check(
    "with no webhook URL the plan is stored and no message goes out",
    alerts.length === 0 && plan?.plan === "standard" && plan?.status === "active",
    { alerts, plan },
  );
}

let passed = false;
try {
  await purchasesAlertTheOperator();
  await noWebhookUrlSendsNothing();
  passed = checks.every((item) => item.passed);
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) console.log(`${item.passed ? "ok  " : "FAIL"} ${item.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!passed) process.exit(1);
