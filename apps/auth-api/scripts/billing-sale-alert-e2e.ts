// Runs the real sales ledger of the account server on a migrated SQLite database, with Stripe invoices
// and a refund of a server plan and of a license. `processPending` must send the operator one message
// for each paid invoice line, each failed payment and each refund, with the account email, the product,
// the amount without VAT and the period, in the form of the purchase messages. A fact that stays pending after a
// failed FX lookup sends its message one time, in the run that ends it. An imported payment and a ledger
// with no alert send no message.
//
// Run: bun run test:billing-sale-alert
// It writes .openbot-build/billing-sale-alert-e2e/report.json and exits non-zero on a failure.
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { BillingSales, type BillingSalesSynced } from "../src/server/billing-sales";
import { createHostedPoolAlert } from "../src/server/hosted-pool-alert";
import type { StripeEvent } from "../src/server/stripe-client";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "billing-sale-alert-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const ALERT_URL = "https://alerts.example/webhook";
const NOW = Date.UTC(2026, 10, 15, 12);
const DAY = "2026-11-15";
const OWNER = { id: "owner", email: "owner@example.test" };

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

function invoice(type: StripeEvent["type"], id: string, object: StripeEvent["data"]["object"]): StripeEvent {
  return { id: `evt_${id}`, type, created: NOW / 1_000, data: { object: { id: `in_${id}`, ...object } } };
}

const SERVER_PAID =
  "Paid server plan for `owner@example.test`: standard, $29.00 (USD), 1 month period. First purchase.";
const SERVER_FAILED =
  "Failed payment of the server plan for `owner@example.test`: standard, $29.00 (USD), 1 month period. Reason: card_declined.";
const LICENSE_PAID = "Paid license for `owner@example.test`: 5 users, PLN\u00a0480.00 (PLN), 1 year period. Renewal.";
const LICENSE_REFUNDED = "Refunded license for `owner@example.test`: 5 users, PLN\u00a0120.00 (PLN), 1 year period.";

async function eachPaidInvoiceSendsOneMessage() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  database
    .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
    .run(OWNER.id, `email:${OWNER.email}`, OWNER.email);

  const alerts: string[] = [];
  const fetch = async (input: string, init: RequestInit) => {
    if (input === ALERT_URL) {
      alerts.push(String(JSON.parse(String(init.body)).content));
      return new Response(null, { status: 204 });
    }
    // The ECB rates and OpenPanel are not there in this test.
    return new Response(null, { status: 503 });
  };
  const options = { database: sqliteD1(database), clientId: "client", clientSecret: "secret", fetch, now: () => NOW };
  const sales = new BillingSales({ ...options, saleAlert: createHostedPoolAlert(ALERT_URL, fetch) });
  const run = (work: Effect.Effect<void, unknown>) => Effect.runPromise(work);
  const pending = () =>
    Number(
      database.prepare("SELECT count(*) AS n FROM billing_sales_facts WHERE delivery_enqueued_at IS NULL").get()?.n,
    );

  const server: BillingSalesSynced = { userId: OWNER.id, plan: "standard", interval: "month", currency: "usd" };
  const license: BillingSalesSynced = {
    product: "license",
    userId: OWNER.id,
    users: 5,
    interval: "year",
    currency: "pln",
  };

  await run(
    sales.webhook(
      invoice("invoice.paid", "server", {
        subscription: "sub_server",
        currency: "usd",
        amount_paid: 2900,
        billing_reason: "subscription_create",
      }),
      server,
    ),
  );
  await run(
    sales.webhook(
      invoice("invoice.payment_failed", "failed", {
        subscription: "sub_server",
        currency: "usd",
        amount_due: 2900,
        billing_reason: "subscription_cycle",
        attempt_count: 1,
        last_payment_error: { code: "card_declined" },
      }),
      server,
    ),
  );
  await run(
    sales.webhook(
      invoice("invoice.paid", "imported", {
        subscription: "sub_server",
        currency: "usd",
        amount_paid: 2900,
        billing_reason: "subscription_cycle",
      }),
      server,
      null,
      { suppressBillingAction: true },
    ),
  );
  await run(
    sales.webhook(
      invoice("invoice.paid", "trial", {
        subscription: "sub_trial",
        currency: "usd",
        amount_paid: 0,
        billing_reason: "subscription_create",
      }),
      server,
    ),
  );
  check("a webhook sends no message: only the ledger run does", alerts.length === 0, alerts);

  await run(sales.processPending());
  check(
    "a paid server plan and a failed payment each send one message with the email, the plan, the amount and the period",
    alerts.length === 2 && alerts.includes(SERVER_PAID) && alerts.includes(SERVER_FAILED),
    [...alerts],
  );
  check("an imported payment and a $0 trial invoice send no message, and no fact stays pending", pending() === 0, {
    pending: pending(),
  });

  await run(
    sales.webhook(
      invoice("invoice.paid", "license", {
        subscription: "sub_license",
        currency: "pln",
        // 23% VAT on top of 480 zł. The message and the revenue count only 480 zł.
        amount_paid: 59040,
        total: 59040,
        total_excluding_tax: 48000,
        billing_reason: "subscription_cycle",
      }),
      license,
    ),
  );
  await run(sales.processPending());
  check(
    "a paid license whose FX lookup fails stays pending and sends no message",
    alerts.length === 2 && pending() === 1,
    { alerts: [...alerts], pending: pending() },
  );

  database
    .prepare("INSERT INTO billing_fx_rates (day, currency, source_day, usd_rate) VALUES (?, 'pln', ?, 0.25)")
    .run(DAY, DAY);
  await run(sales.processPending());
  await run(sales.processPending());
  check(
    "the run that ends the fact sends its message one time, with the amount without VAT",
    alerts.length === 3 && alerts[2] === LICENSE_PAID,
    [...alerts],
  );

  await run(
    sales.webhook(
      {
        id: "evt_refund",
        type: "refund.created",
        created: NOW / 1_000,
        data: {
          object: {
            id: "re_license",
            status: "succeeded",
            payment_intent: "pi_license",
            // A quarter of the payment, VAT included.
            amount: 14760,
            currency: "pln",
          },
        },
      },
      license,
      { invoiceId: "in_license", subscriptionId: "sub_license", total: 59040, totalExcludingTax: 48000 },
    ),
  );
  await run(sales.processPending());
  check(
    "a refund sends one message with the refunded amount without VAT",
    alerts.length === 4 && alerts[3] === LICENSE_REFUNDED,
    [...alerts],
  );
  check(
    "a message has the account email and no account ID or Stripe ID",
    alerts.every(
      (alert) =>
        alert.includes(`\`${OWNER.email}\``) && !alert.includes(`${OWNER.id} `) && !/\b(sub|in|re|pi|cus)_/.test(alert),
    ),
    [...alerts],
  );

  const silent = new BillingSales(options);
  await run(
    silent.webhook(
      invoice("invoice.paid", "silent", {
        subscription: "sub_server",
        currency: "usd",
        amount_paid: 2900,
        billing_reason: "subscription_cycle",
      }),
      server,
    ),
  );
  await run(silent.processPending());
  check("a ledger with no alert ends the fact and sends nothing", alerts.length === 4 && pending() === 0, {
    alerts: [...alerts],
    pending: pending(),
  });
}

let passed = false;
try {
  await eachPaidInvoiceSendsOneMessage();
  passed = checks.every((item) => item.passed);
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) console.log(`${item.passed ? "ok  " : "FAIL"} ${item.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!passed) process.exit(1);
