// Runs the real daily billing snapshot on a migrated SQLite database, with a Stripe API that knows a
// fixed set of subscriptions (#2242). The snapshot must not read canceled or expired subscriptions
// from Stripe, must read each FX rate once, must count and leave out subscriptions that stay bad, and
// must fail without an event when Stripe has a failure that can pass or when every row is bad. A second
// run on the same day makes no Stripe call. License subscriptions go in their own totals, and the
// server plan totals do not include them.
//
// Run: bun apps/auth-api/scripts/billing-snapshot-e2e.ts
// It writes .openbot-build/billing-snapshot-e2e/report.json and exits non-zero on a failure.
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { LICENSE_METADATA, LICENSE_METADATA_KIND, licenseLookupKey } from "@openbot/contracts/license";
import { Effect, Exit, Schema } from "effect";
import { captureBillingSnapshot } from "../src/server/billing-snapshots";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "billing-snapshot-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const NOW = Date.UTC(2026, 9, 16, 12);
const DAY = "2026-10-16";
const EUR_USD = 1.1;
const BINDINGS = { STRIPE_SECRET_KEY: "sk_test_e2e", OPENPANEL_CLIENT_ID: "client", OPENPANEL_CLIENT_SECRET: "secret" };

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

/** A D1 binding over node:sqlite, with the calls that the snapshot makes. Each query goes to `queries`. */
function sqliteD1(database: DatabaseSync, queries: string[]): D1Database {
  const changes = () => Number(database.prepare("SELECT total_changes() AS changes").get()?.changes);
  const result = <T>(results: T[], changed: number): D1Result<T> => ({
    success: true,
    results,
    meta: {
      changes: changed,
      duration: 0,
      last_row_id: 0,
      changed_db: changed > 0,
      size_after: 0,
      rows_read: 0,
      rows_written: changed,
    },
  });
  const statement = (query: string, values: SQLInputValue[] = []): D1PreparedStatement => ({
    bind: (...input: unknown[]) =>
      statement(
        query,
        input.map((value) => {
          if (value === null || typeof value === "string" || typeof value === "number") return value;
          throw new Error("Invalid binding");
        }),
      ),
    async first<T>(column?: string): Promise<T | null> {
      queries.push(query);
      const row = database.prepare(query).get(...values);
      return row ? JSON.parse(JSON.stringify(column ? row[column] : row)) : null;
    },
    async all<T>(): Promise<D1Result<T>> {
      queries.push(query);
      const before = changes();
      const rows = JSON.parse(JSON.stringify(database.prepare(query).all(...values)));
      return result<T>(rows, changes() - before);
    },
    async run<T>(): Promise<D1Result<T>> {
      queries.push(query);
      const before = changes();
      database.prepare(query).run(...values);
      return result<T>([], changes() - before);
    },
    raw: () => {
      throw new Error("Unused raw");
    },
  });
  const unused = () => {
    throw new Error("Unused");
  };
  return {
    prepare: (query: string) => statement(query),
    batch: unused,
    exec: unused,
    withSession: unused,
    dump: unused,
  };
}

type StoredRow = { id: string; status: string; serverId?: string; licenseUsers?: number };

function migratedDatabase(rows: readonly StoredRow[]): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  database
    .prepare("INSERT INTO billing_fx_rates(day, currency, source_day, usd_rate) VALUES (?, 'eur', ?, ?)")
    .run(DAY, DAY, EUR_USD);
  for (const [index, row] of rows.entries()) {
    const userId = `user-${index}`;
    database
      .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
      .run(userId, `email:${userId}@example.test`, `${userId}@example.test`);
    if (row.licenseUsers !== undefined) {
      database
        .prepare(
          `INSERT INTO licenses(
             stripe_subscription_id, user_id, stripe_customer_id, users, currency, status, current_period_end,
             cancel_at_period_end, updated_at
           ) VALUES (?, ?, ?, ?, 'eur', ?, NULL, 0, 1)`,
        )
        .run(row.id, userId, `cus_${index}`, row.licenseUsers, row.status);
      continue;
    }
    database
      .prepare(
        `INSERT INTO billing_subscriptions(
           stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, amount,
           status, current_period_end, cancel_at_period_end, updated_at
         ) VALUES (?, ?, ?, ?, 'standard', 'month', 'eur', 1000, ?, NULL, 0, 1)`,
      )
      .run(row.id, userId, `cus_${index}`, row.serverId ?? null, row.status);
  }
  return database;
}

function stripeSubscription(
  id: string,
  status: string,
  currency: string,
  amount: number,
  interval: string,
  quantity = 1,
) {
  return {
    id,
    status,
    currency,
    cancel_at_period_end: false,
    items: { data: [{ price: { currency, unit_amount: amount, recurring: { interval } }, quantity }] },
    discounts: [],
  };
}

/**
 * The Team monthly license Price. It has graduated tiers, so Stripe sends no `unit_amount`, and its lookup key
 * and metadata name the plan (`scripts/stripe-bootstrap.ts`).
 */
function stripeLicenseSubscription(id: string, currency: string, users: number) {
  const plan = { tier: "team", interval: "month", bundle: false } as const;
  return {
    id,
    status: "active",
    currency,
    cancel_at_period_end: false,
    items: {
      data: [
        {
          price: {
            lookup_key: licenseLookupKey(plan),
            metadata: {
              [LICENSE_METADATA.kind]: LICENSE_METADATA_KIND,
              [LICENSE_METADATA.tier]: plan.tier,
              [LICENSE_METADATA.interval]: plan.interval,
            },
            currency,
            unit_amount: null,
            billing_scheme: "tiered",
            recurring: { interval: plan.interval },
          },
          quantity: users,
        },
      ],
    },
    discounts: [],
  };
}

/** A Stripe API stub. A body is a subscription; a number is an error status. Each URL goes to `calls`. */
function stripeFetch(subscriptions: Record<string, object | number>, calls: string[]) {
  return async (input: string) => {
    calls.push(input);
    const url = new URL(input);
    if (url.origin !== "https://api.stripe.com") throw new Error(`Unexpected request: ${url.origin}`);
    const id = decodeURIComponent(url.pathname.replace("/v1/subscriptions/", ""));
    const answer = subscriptions[id];
    if (answer === undefined) throw new Error(`Unexpected Stripe subscription: ${id}`);
    return typeof answer === "number" ? new Response("{}", { status: answer }) : Response.json(answer);
  };
}

const SnapshotMetrics = Schema.Struct({
  snapshot_date: Schema.String,
  mrr: Schema.Int,
  arr: Schema.Int,
  overdue_mrr: Schema.Int,
  paying_accounts: Schema.Int,
  paid_servers: Schema.Int,
  cancellations_scheduled: Schema.Int,
  license_mrr: Schema.Int,
  license_accounts: Schema.Int,
  licensed_users: Schema.Int,
  total_mrr: Schema.Int,
  total_arr: Schema.Int,
  skipped_subscriptions: Schema.Int,
});

function storedEvents(database: DatabaseSync): (typeof SnapshotMetrics.Type)[] {
  return database
    .prepare("SELECT properties_json FROM billing_analytics_events WHERE event_name = 'billing_snapshot'")
    .all()
    .map((row) => Schema.decodeUnknownSync(SnapshotMetrics)(JSON.parse(String(row.properties_json))));
}

async function snapshotSkipsTerminalAndBadRows() {
  const database = migratedDatabase([
    { id: "sub_canceled", status: "canceled" },
    { id: "sub_expired", status: "incomplete_expired" },
    { id: "sub_eur_1", status: "active", serverId: "server-1" },
    { id: "sub_eur_2", status: "active" },
    { id: "sub_usd_year", status: "past_due" },
    { id: "sub_trial", status: "trialing" },
    { id: "sub_missing", status: "active" },
    { id: "sub_weekly", status: "active" },
    { id: "sub_license", status: "active", licenseUsers: 7 },
    { id: "sub_license_canceled", status: "canceled", licenseUsers: 2 },
  ]);
  const queries: string[] = [];
  const calls: string[] = [];
  const fetcher = stripeFetch(
    {
      sub_eur_1: stripeSubscription("sub_eur_1", "active", "eur", 1_000, "month"),
      sub_eur_2: stripeSubscription("sub_eur_2", "active", "eur", 2_000, "month"),
      sub_usd_year: stripeSubscription("sub_usd_year", "past_due", "usd", 12_000, "year"),
      sub_trial: stripeSubscription("sub_trial", "trialing", "eur", 1_000, "month"),
      sub_missing: 404,
      sub_weekly: stripeSubscription("sub_weekly", "active", "eur", 1_000, "week"),
      sub_license: stripeLicenseSubscription("sub_license", "eur", 7),
    },
    calls,
  );
  const bindings = { ...BINDINGS, DB: sqliteD1(database, queries) };
  const exit = await Effect.runPromiseExit(captureBillingSnapshot(bindings, NOW, fetcher));
  check("the snapshot succeeds with bad rows", Exit.isSuccess(exit), exit);
  const read = calls.map((url) => new URL(url).pathname.replace("/v1/subscriptions/", "")).sort();
  check(
    "Stripe is read only for subscriptions that are not canceled or expired",
    JSON.stringify(read) ===
      JSON.stringify(
        ["sub_eur_1", "sub_eur_2", "sub_missing", "sub_trial", "sub_usd_year", "sub_weekly", "sub_license"].sort(),
      ),
    read,
  );
  const fxReads = queries.filter((query) => query.includes("FROM billing_fx_rates")).length;
  check("the EUR rate is read once", fxReads === 1, { fxReads });
  const [event] = storedEvents(database);
  // EUR: round(1000 * 1.1) + round(2000 * 1.1); USD yearly: 12000 / 12. License: 7 users = 2500 + 5 * 1500, round(10000 * 1.1).
  const expected = {
    snapshot_date: DAY,
    mrr: 1_100 + 2_200 + 1_000,
    arr: (1_100 + 2_200 + 1_000) * 12,
    overdue_mrr: 1_000,
    paying_accounts: 3,
    paid_servers: 1,
    cancellations_scheduled: 0,
    license_mrr: 11_000,
    license_accounts: 1,
    licensed_users: 7,
    total_mrr: 1_100 + 2_200 + 1_000 + 11_000,
    total_arr: (1_100 + 2_200 + 1_000 + 11_000) * 12,
    skipped_subscriptions: 2,
  };
  check("the event has the expected metrics", JSON.stringify(event) === JSON.stringify(expected), {
    expected,
    actual: event ?? null,
  });

  calls.length = 0;
  const again = await Effect.runPromiseExit(captureBillingSnapshot(bindings, NOW + 5 * 60_000, fetcher));
  check("a second run on the same day makes no Stripe call", Exit.isSuccess(again) && calls.length === 0, {
    calls,
  });
}

async function transientStripeFailureFailsTheRun() {
  const database = migratedDatabase([
    { id: "sub_ok", status: "active" },
    { id: "sub_unavailable", status: "active" },
  ]);
  const fetcher = stripeFetch(
    { sub_ok: stripeSubscription("sub_ok", "active", "eur", 1_000, "month"), sub_unavailable: 503 },
    [],
  );
  const exit = await Effect.runPromiseExit(
    captureBillingSnapshot({ ...BINDINGS, DB: sqliteD1(database, []) }, NOW, fetcher),
  );
  const code = Exit.isFailure(exit) ? JSON.stringify(exit.cause) : null;
  check("a Stripe 503 fails the run", Exit.isFailure(exit) && code?.includes('"stripe"') === true, code);
  check("a failed run stores no event", storedEvents(database).length === 0);
}

async function allRowsBadFailsTheRun() {
  // A Stripe key of another account or mode gives a 404 for each subscription.
  const database = migratedDatabase([
    { id: "sub_other_1", status: "active" },
    { id: "sub_other_2", status: "past_due" },
    { id: "sub_closed", status: "canceled" },
  ]);
  const fetcher = stripeFetch({ sub_other_1: 404, sub_other_2: 404 }, []);
  const exit = await Effect.runPromiseExit(
    captureBillingSnapshot({ ...BINDINGS, DB: sqliteD1(database, []) }, NOW, fetcher),
  );
  const code = Exit.isFailure(exit) ? JSON.stringify(exit.cause) : null;
  check(
    "a 404 for every open subscription fails the run",
    Exit.isFailure(exit) && code?.includes('"missing_subscription"') === true,
    code,
  );
  check("a run with every row bad stores no event", storedEvents(database).length === 0);
}

let passed = false;
try {
  await snapshotSkipsTerminalAndBadRows();
  await transientStripeFailureFailsTheRun();
  await allRowsBadFailsTheRun();
  passed = checks.every((item) => item.passed);
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) console.log(`${item.passed ? "ok  " : "FAIL"} ${item.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!passed) process.exit(1);
