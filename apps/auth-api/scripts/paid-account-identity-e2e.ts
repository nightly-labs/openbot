// Runs the real account analytics and sales ledger on a migrated SQLite database, with an OpenPanel
// API that records each request. A paid billing event of a server plan or a license must set the
// normalized account email on the profile (OpenPanel `identify`) and send the event with no email. An
// event that is not a payment must not identify. A failed identify or a failed email read must not
// stop the event. The ledger identifies an account once in each drain.
//
// Run: bun apps/auth-api/scripts/paid-account-identity-e2e.ts
// It writes .openbot-build/paid-account-identity-e2e/report.json and exits non-zero on a failure.
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { type AccountAnalyticsEvent, createAccountAnalytics } from "../src/server/account-analytics";
import { SalesAnalyticsDelivery } from "../src/server/sales-analytics-delivery";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "paid-account-identity-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const PAYER = { id: "payer", email: "  Payer.Name@Example.TEST " };
const NORMALIZED_EMAIL = "payer.name@example.test";

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

interface Request {
  type: string;
  /** A track has `name` and `properties`; an identify has `email`. */
  payload: { profileId?: string; name?: string; email?: string; properties?: object };
}

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  database
    .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
    .run(PAYER.id, "email:payer", PAYER.email);
  return database;
}

/** An OpenPanel API that records each request and can refuse `identify`. */
function openPanel() {
  const requests: Request[] = [];
  const state = { refuseIdentify: false };
  const fetch = async (_input: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push({ type: body.type, payload: body.payload });
    return new Response("{}", { status: state.refuseIdentify && body.type === "identify" ? 500 : 200 });
  };
  return { requests, state, fetch };
}

const isIdentity = (request: Request | undefined) =>
  request?.type === "identify" &&
  JSON.stringify(request.payload) === JSON.stringify({ profileId: PAYER.id, email: NORMALIZED_EMAIL });
const hasNoEmail = (requests: readonly Request[]) =>
  requests.filter((request) => request.type === "track").every((request) => !JSON.stringify(request).includes("@"));

async function accountAnalytics() {
  const database = migratedDatabase();
  const api = openPanel();
  const work: Promise<void>[] = [];
  const analytics = createAccountAnalytics({
    clientId: "client",
    clientSecret: "secret",
    fetch: api.fetch,
    schedule: (send) => work.push(Effect.runPromise(send)),
    database: sqliteD1(database),
  });
  const send = async (accountId: string | null, event: AccountAnalyticsEvent) => {
    api.requests.length = 0;
    analytics.track(accountId, event);
    await Promise.all(work.splice(0));
    return [...api.requests];
  };

  for (const action of [
    "plan_started",
    "payment_succeeded",
    "plan_changed",
    "cancel_scheduled",
    "cancel_withdrawn",
  ] as const) {
    for (const product of ["license", "server"] as const) {
      const requests = await send(PAYER.id, { name: "billing_action", action, product });
      check(
        `${product} ${action} identifies the account and sends the event`,
        requests.length === 2 && requests.some(isIdentity) && requests.some((request) => request.type === "track"),
        requests,
      );
      check(`${product} ${action} sends no email in the event`, hasNoEmail(requests), requests);
    }
  }
  for (const action of [
    "checkout_started",
    "checkout_expired",
    "payment_failed",
    "plan_ended",
    "portal_opened",
  ] as const) {
    const requests = await send(PAYER.id, { name: "billing_action", action });
    check(`${action} does not identify`, requests.length === 1 && requests[0]?.type === "track", requests);
  }
  const server = await send(PAYER.id, { name: "hosted_server_action", action: "provisioned" });
  check("a hosted server event does not identify", server.length === 1 && server[0]?.type === "track", server);
  const email = await send(null, { name: "email_sent", kind: "welcome", result: "accepted" });
  check(
    "an event with no account has no profile and does not identify",
    email.length === 1 && email[0]?.type === "track" && !("profileId" in (email[0]?.payload ?? {})),
    email,
  );
  const unknown = await send("gone", { name: "billing_action", action: "payment_succeeded" });
  check("an account with no row sends only the event", unknown.length === 1 && unknown[0]?.type === "track", unknown);

  api.state.refuseIdentify = true;
  const refused = await send(PAYER.id, { name: "billing_action", action: "payment_succeeded" });
  check(
    "a refused identify still sends the event",
    refused.some((request) => request.type === "track"),
    refused,
  );
  api.state.refuseIdentify = false;

  database.exec("PRAGMA foreign_keys = OFF; DROP TABLE users");
  const unread = await send(PAYER.id, { name: "billing_action", action: "payment_succeeded" });
  check("a failed email read still sends the event", unread.length === 1 && unread[0]?.type === "track", unread);
}

async function salesLedger() {
  const database = migratedDatabase();
  const api = openPanel();
  const ledger = new SalesAnalyticsDelivery({
    database: sqliteD1(database),
    clientId: "client",
    clientSecret: "secret",
    fetch: api.fetch,
    now: () => Date.UTC(2026, 9, 31, 12),
  });
  const at = Date.UTC(2026, 9, 31, 11);
  const sale = { product: "license", users: 3, interval: "month", currency: "eur", amount: 3000 };
  await Effect.runPromise(
    Effect.all([
      ledger.enqueue("billing:paid", PAYER.id, "billing_action", { ...sale, action: "payment_succeeded" }, at),
      ledger.enqueue("revenue:paid", PAYER.id, "revenue", { __revenue: 3300, amount_usd: 3300, currency: "eur" }, at),
      ledger.enqueue("billing:failed", PAYER.id, "billing_action", { ...sale, action: "payment_failed" }, at),
    ]),
  );
  const summary = await Effect.runPromise(ledger.drain());
  const identities = api.requests.filter((request) => request.type === "identify");
  const tracks = api.requests.filter((request) => request.type === "track");
  check("the ledger sends each event", summary.sent === 3 && tracks.length === 3, { summary, requests: api.requests });
  check(
    "the ledger identifies a paying account once in a drain",
    identities.length === 1 && isIdentity(identities[0]),
    identities,
  );
  check(
    "the ledger identifies before the first payment event",
    isIdentity(api.requests[0]) && api.requests[1]?.type === "track",
    api.requests,
  );
  check("the ledger sends no email in an event", hasNoEmail(api.requests), tracks);

  const failedOnly = migratedDatabase();
  const unpaidApi = openPanel();
  const unpaid = new SalesAnalyticsDelivery({
    database: sqliteD1(failedOnly),
    clientId: "client",
    clientSecret: "secret",
    fetch: unpaidApi.fetch,
  });
  await Effect.runPromise(
    unpaid.enqueue("billing:failed", PAYER.id, "billing_action", { ...sale, action: "payment_failed" }, at),
  );
  await Effect.runPromise(unpaid.drain());
  check(
    "the ledger does not identify for a failed payment",
    unpaidApi.requests.every((request) => request.type === "track"),
    unpaidApi.requests,
  );

  const refusedDatabase = migratedDatabase();
  const refusedApi = openPanel();
  refusedApi.state.refuseIdentify = true;
  const refused = new SalesAnalyticsDelivery({
    database: sqliteD1(refusedDatabase),
    clientId: "client",
    clientSecret: "secret",
    fetch: refusedApi.fetch,
  });
  await Effect.runPromise(
    refused.enqueue("billing:paid", PAYER.id, "billing_action", { ...sale, action: "payment_succeeded" }, at),
  );
  const refusedSummary = await Effect.runPromise(refused.drain());
  check("a refused identify does not change the ledger outcome", refusedSummary.sent === 1, refusedSummary);
}

let passed = false;
try {
  await accountAnalytics();
  await salesLedger();
  passed = checks.every((item) => item.passed);
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) console.log(`${item.passed ? "ok  " : "FAIL"} ${item.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!passed) process.exit(1);
