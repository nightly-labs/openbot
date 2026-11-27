import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  CREDIT_ACTIVITY_LIMIT,
  CREDIT_METADATA,
  CREDIT_METADATA_KIND,
  type CreditActivityEntry,
  creditLookupKey,
  creditStops,
  formatCreditCode,
  parseCreditActivity,
  parseCreditRedeemRequest,
  parseCreditTransferRequest,
} from "@openbot/contracts/credits";
import { Effect } from "effect";
import { createAccountAnalytics } from "../src/server/account-analytics";
import { BillingError, type BillingOperationError } from "../src/server/billing-errors";
import { CREDIT_AUDIT_RETENTION_MS, CreditAudit } from "../src/server/credit-audit";
import {
  CREDIT_CODE_LIMIT_WINDOW_MS,
  CREDIT_CODE_LIMITS,
  type CreditCodeLimit,
  creditCodeHash,
  generateCreditCode,
} from "../src/server/credit-codes";
import { CreditGrants, consumeGrantsSql, licenseCreditSlot } from "../src/server/credit-grants";
import type { CreditService } from "../src/server/credit-service";
import {
  CREDIT_HOLD_FIRST_CHECK_MS,
  CREDIT_HOLD_LIMIT_MS,
  CREDIT_HOLD_START_GRACE_MS,
  type CreditJobCheck,
  CreditSpending,
  type CreditWallet,
} from "../src/server/credit-spending";
import { createHostedBilling } from "../src/server/hosted-billing";
import { RemoteControlPlane } from "../src/server/remote-control-plane";
import { EARLY_START_METADATA } from "../src/server/stripe-client";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "credits-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const WEBHOOK_SECRET = "whsec_test";
const ORIGIN = "https://openbot.test";
const OWNER = { id: "owner", email: "owner@example.test" };
const MEMBER = { id: "member", email: "member@example.test" };
const OUTSIDER = { id: "outsider", email: "outsider@example.test" };
const SERVER_ID = "host-studio";
const LAB_ID = "host-lab";
const EMPTY_ID = "host-empty";

interface StripeEventObject {
  id: string;
  object: string;
  status?: string;
  mode?: string;
  currency?: string;
  amount?: number;
  amount_total?: number;
  payment_status?: string;
  payment_intent?: string;
  metadata?: Readonly<Record<string, string>>;
  customer?: string;
  amount_paid?: number;
  total?: number;
  total_excluding_tax?: number;
  customer_tax_exempt?: string;
  customer_address?: { country: string };
}

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

type WelcomeStart = "used" | "unissued";

function settledGrantSearches(database: DatabaseSync): string {
  const charged = `SELECT user_id, server_id, funding, charged_tenths AS tenths, created_at FROM credit_holds
    WHERE job_id = ?1 AND status = 'charged'`;
  return database
    .prepare(`EXPLAIN QUERY PLAN ${consumeGrantsSql(charged)}`)
    .all("job-1")
    .map((row) => String(row.detail))
    .join("; ");
}

function migratedDatabase(welcome: WelcomeStart): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  for (const user of [OWNER, MEMBER, OUTSIDER]) {
    database
      .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
      .run(user.id, `email:${user.email}`, user.email);
    if (welcome === "used") {
      database
        .prepare(
          "INSERT INTO credit_grants(grant_id, user_id, credits_tenths, remaining_tenths, source, scope, starts_at, expires_at, created_at) VALUES (?, ?, 100, 0, 'welcome', 'welcome', 0, ?, 0)",
        )
        .run(`welcome:${user.id}`, user.id, Date.UTC(9999, 11, 31));
    }
  }
  database.exec(`
    INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
    VALUES ('${SERVER_ID}', '${OWNER.id}', 'Studio', 1, 1);
    INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
    VALUES ('m-owner', '${SERVER_ID}', '${OWNER.id}', 'owner', 'active', 1, 1),
           ('m-member', '${SERVER_ID}', '${MEMBER.id}', 'member', 'active', 1, 1);
  `);
  return database;
}

function prices() {
  return creditStops("eur").map((stop) => ({
    id: `price_${stop.eurMinor}`,
    lookup_key: creditLookupKey(stop),
    currency: "eur",
    unit_amount: stop.eurMinor,
    currency_options: { usd: { unit_amount: stop.eurMinor } },
    metadata: {},
  }));
}

interface TrackedEvent {
  name: string;
  profileId: string | null;
  properties: Map<string, string | number | boolean>;
}

function trackedEvent(body: unknown): TrackedEvent | null {
  if (typeof body !== "object" || body === null || !("type" in body) || body.type !== "track") return null;
  if (!("payload" in body) || typeof body.payload !== "object" || body.payload === null) return null;
  const payload = body.payload;
  if (!("name" in payload) || typeof payload.name !== "string") return null;
  if (!("properties" in payload) || typeof payload.properties !== "object" || payload.properties === null) return null;
  const properties = new Map<string, string | number | boolean>();
  for (const [key, item] of Object.entries(payload.properties)) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") properties.set(key, item);
  }
  return {
    name: payload.name,
    profileId: "profileId" in payload && typeof payload.profileId === "string" ? payload.profileId : null,
    properties,
  };
}

function eventsOf(
  events: readonly TrackedEvent[],
  profileId: string,
  expected: Readonly<Record<string, string | number | boolean>>,
) {
  return events.filter(
    (event) =>
      event.profileId === profileId &&
      Object.entries(expected).every(([key, value]) => event.properties.get(key) === value),
  );
}

function readable(events: readonly TrackedEvent[]) {
  return events.map((event) => ({ ...event, properties: Object.fromEntries(event.properties) }));
}

function countActions(events: readonly TrackedEvent[]) {
  const counts: Record<string, number> = {};
  for (const event of events) {
    const action = String(event.properties.get("action"));
    counts[action] = (counts[action] ?? 0) + 1;
  }
  return counts;
}

function keepsPrivate(events: readonly TrackedEvent[], hidden: readonly string[]) {
  const sent = JSON.stringify(readable(events));
  return hidden.every((value) => !sent.includes(value));
}

function fakeStripe() {
  const sessions: URLSearchParams[] = [];
  const unknown: string[] = [];
  const outside: string[] = [];
  const tracked: TrackedEvent[] = [];
  const fetch = async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    if (url.origin !== "https://api.stripe.com") {
      outside.push(`${method} ${url.origin}${url.pathname}`);
      const event = typeof init.body === "string" ? trackedEvent(JSON.parse(init.body)) : null;
      if (event) tracked.push(event);
      return Response.json({});
    }
    if (method === "GET" && url.pathname === "/v1/prices") {
      const keys = new Set(url.searchParams.getAll("lookup_keys[]"));
      return Response.json({ data: prices().filter((price) => keys.has(price.lookup_key)) });
    }
    if (method === "POST" && url.pathname === "/v1/customers") {
      const body = new URLSearchParams(String(init.body));
      return Response.json({ id: `cus_${body.get("metadata[openbot_user_id]") ?? "x"}` });
    }
    if (method === "GET" && url.pathname.startsWith("/v1/customers/")) {
      return Response.json({ id: decodeURIComponent(url.pathname.slice(14)), metadata: {}, tax_ids: { data: [] } });
    }
    if (method === "POST" && url.pathname === "/v1/checkout/sessions") {
      const body = new URLSearchParams(String(init.body));
      sessions.push(body);
      const id = `cs_${sessions.length}`;
      return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}`, status: "open", metadata: {} });
    }
    unknown.push(`${method} ${url.pathname}`);
    if (method === "GET") return Response.json({ data: [], has_more: false });
    return Response.json({ error: { type: "api_error" } }, { status: 500 });
  };
  return { sessions, unknown, outside, tracked, fetch };
}

interface AuditRow {
  event: string;
  result: string;
  code: string | null;
  user_id: string | null;
  server_id: string | null;
  actor_user_id: string | null;
  credits_tenths: number | null;
  model_id: string | null;
  reference: string | null;
  detail: string | null;
}

function auditRows(database: DatabaseSync): AuditRow[] {
  return database
    .prepare(
      `SELECT event, result, code, user_id, server_id, actor_user_id, credits_tenths, model_id, reference, detail
         FROM credit_audit ORDER BY created_at, rowid`,
    )
    .all()
    .map((row) => ({
      event: String(row.event),
      result: String(row.result),
      code: row.code === null ? null : String(row.code),
      user_id: row.user_id === null ? null : String(row.user_id),
      server_id: row.server_id === null ? null : String(row.server_id),
      actor_user_id: row.actor_user_id === null ? null : String(row.actor_user_id),
      credits_tenths: row.credits_tenths === null ? null : Number(row.credits_tenths),
      model_id: row.model_id === null ? null : String(row.model_id),
      reference: row.reference === null ? null : String(row.reference),
      detail: row.detail === null ? null : String(row.detail),
    }));
}

function audited(rows: readonly AuditRow[], match: Partial<AuditRow>): AuditRow[] {
  return rows.filter((row) => JSON.stringify({ ...row, ...match }) === JSON.stringify(row));
}

async function failure(effect: Effect.Effect<unknown, BillingError | BillingOperationError>) {
  const error = await Effect.runPromise(Effect.flip(effect));
  if (error instanceof BillingError) return { status: error.status, code: error.code };
  return { status: 500, code: error._tag };
}

async function controlPlane(database: DatabaseSync) {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
  return new RemoteControlPlane(
    {
      DB: sqliteD1(database),
      REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ ...privateJwk, kid: "ticket-1" }),
      REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [{ ...publicJwk, kid: "ticket-1" }] }),
      REMOTE_TICKET_KEY_ID: "ticket-1",
    },
    { now: () => Date.now(), schedule: () => undefined },
  );
}

function addOwnedServer(database: DatabaseSync, serverId: string) {
  database.exec(`
    INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
    VALUES ('${serverId}', '${OWNER.id}', '${serverId}', 1, 1);
    INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
    VALUES ('m-${serverId}', '${serverId}', '${OWNER.id}', 'owner', 'active', 1, 1);
  `);
}

async function harness(welcome: WelcomeStart = "used") {
  const database = migratedDatabase(welcome);
  const stripe = fakeStripe();
  const work: Promise<void>[] = [];
  const { billing } = createHostedBilling(
    {
      DB: sqliteD1(database),
      STRIPE_SECRET_KEY: "sk_test_credits",
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      OPENPANEL_CLIENT_ID: "openpanel-test",
      OPENPANEL_CLIENT_SECRET: "openpanel-test-secret",
    },
    {
      removeHost: () => Effect.void,
      planChanged: () => Effect.void,
      licenseChanged: () => Effect.void,
      schedule: (effect) => work.push(Effect.runPromise(effect)),
      fetch: stripe.fetch,
    },
  );
  if (!billing) throw new Error("Billing is off.");
  const credits: CreditService = billing.credits;
  let sent = 0;
  const deliver = async (type: string, object: StripeEventObject) => {
    sent += 1;
    const created = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ id: `evt_${sent}`, type, created, data: { object } });
    const signature = createHmac("sha256", WEBHOOK_SECRET).update(`${created}.${payload}`).digest("hex");
    await Effect.runPromise(billing.handleWebhook(payload, `t=${created},v1=${signature}`));
    await Promise.all(work.splice(0));
  };
  const session = (id: string, user: string, amount: number, bought: number, serverId?: string, currency = "eur") => ({
    id,
    object: "checkout.session",
    mode: "payment",
    currency,
    amount_total: amount,
    metadata: {
      [CREDIT_METADATA.kind]: CREDIT_METADATA_KIND,
      [CREDIT_METADATA.userId]: user,
      [CREDIT_METADATA.credits]: String(bought),
      ...(serverId === undefined ? {} : { [CREDIT_METADATA.serverId]: serverId }),
    },
  });
  const state = (userId: string) => Effect.runPromise(credits.getState(userId));
  const purchaseStatus = (id: string) =>
    database.prepare("SELECT status FROM credit_purchases WHERE checkout_session_id = ?").get(id)?.status;
  const analytics = createAccountAnalytics({
    clientId: "openpanel-test",
    clientSecret: "openpanel-test-secret",
    fetch: stripe.fetch,
    schedule: (effect) => work.push(Effect.runPromise(effect)),
    database: sqliteD1(database),
  });
  const creditEvents = async () => {
    await Promise.all(work.splice(0));
    return stripe.tracked.filter((event) => event.name === "credit_action");
  };
  return {
    database,
    stripe,
    credits,
    deliver,
    session,
    state,
    purchaseStatus,
    analytics,
    creditEvents,
    sent: () => sent,
  };
}

async function walletsAndTransfers() {
  const { database, stripe, credits, deliver, session, state, purchaseStatus, creditEvents, sent } = await harness();

  const empty = await state(OWNER.id);
  check(
    "a new account sees credits for sale, no credits, and its server with the owner role",
    empty.available &&
      empty.currency === "eur" &&
      JSON.stringify(empty.currencies) === JSON.stringify(["eur", "usd"]) &&
      empty.balance === 0 &&
      empty.servers.length === 1 &&
      empty.servers[0]?.serverId === SERVER_ID &&
      empty.servers[0]?.role === "owner" &&
      empty.servers[0]?.balance === 0,
    empty,
  );
  const memberView = await state(MEMBER.id);
  check(
    "a member sees the server with the member role",
    memberView.servers.length === 1 && memberView.servers[0]?.role === "member",
    memberView,
  );
  const outsiderView = await state(OUTSIDER.id);
  check("an account with no server sees no servers", outsiderView.servers.length === 0, outsiderView);

  const personal = await Effect.runPromise(
    credits.createCheckout({
      user: OWNER,
      request: { credits: 2_000, currency: "eur" },
      target: "desktop",
      origin: ORIGIN,
    }),
  );
  const personalForm = stripe.sessions[0];
  check(
    "a personal checkout is a one-time payment for the price of that pack, with the account in the metadata",
    personal.url === "https://checkout.stripe.com/c/pay/cs_1" &&
      personalForm?.get("mode") === "payment" &&
      personalForm.get("line_items[0][price]") === "price_10000" &&
      personalForm.get(`metadata[${CREDIT_METADATA.kind}]`) === CREDIT_METADATA_KIND &&
      personalForm.get(`metadata[${CREDIT_METADATA.userId}]`) === OWNER.id &&
      personalForm.get(`metadata[${CREDIT_METADATA.credits}]`) === "2000" &&
      personalForm.get(`metadata[${CREDIT_METADATA.serverId}]`) === null &&
      personalForm.get(`metadata[${EARLY_START_METADATA}]`) === null &&
      personalForm.get(`payment_intent_data[metadata][${CREDIT_METADATA.kind}]`) === CREDIT_METADATA_KIND &&
      personalForm.get("invoice_creation[enabled]") === "true" &&
      personalForm.get(`invoice_creation[invoice_data][metadata][${CREDIT_METADATA.kind}]`) === CREDIT_METADATA_KIND &&
      personalForm.get(`invoice_creation[invoice_data][metadata][${CREDIT_METADATA.userId}]`) === OWNER.id &&
      personalForm.get("success_url") === `${ORIGIN}/billing/return?kind=credits`,
    personalForm && Object.fromEntries(personalForm),
  );
  check("the checkout stores an open purchase", purchaseStatus("cs_1") === "open");

  const serverCheckout = await Effect.runPromise(
    credits.createCheckout({
      user: MEMBER,
      request: { credits: 167, currency: "eur", serverId: SERVER_ID, earlyStart: true },
      target: "web",
      origin: ORIGIN,
    }),
  );
  const serverForm = stripe.sessions[1];
  check(
    "a member can buy credits for the server with early-start consent, and the web checkout returns to the web app",
    serverCheckout.url.endsWith("cs_2") &&
      serverForm?.get(`metadata[${CREDIT_METADATA.serverId}]`) === SERVER_ID &&
      !Number.isNaN(Date.parse(serverForm.get(`metadata[${EARLY_START_METADATA}]`) ?? "")) &&
      serverForm.get("success_url") === `${ORIGIN}/app?billing=credits`,
    serverForm && Object.fromEntries(serverForm),
  );

  check(
    "an account that is not a member cannot buy credits for the server",
    (
      await failure(
        credits.createCheckout({
          user: OUTSIDER,
          request: { credits: 167, currency: "eur", serverId: SERVER_ID },
          target: "desktop",
          origin: ORIGIN,
        }),
      )
    ).code === "credits_server_member",
  );
  const odd = await failure(
    credits.createCheckout({
      user: OWNER,
      request: { credits: 1_234, currency: "eur" },
      target: "desktop",
      origin: ORIGIN,
    }),
  );
  check("a pack size that is not for sale is refused", odd.status === 503 && odd.code === "credits_unavailable", odd);
  const brl = await failure(
    credits.createCheckout({
      user: OWNER,
      request: { credits: 167, currency: "brl" },
      target: "desktop",
      origin: ORIGIN,
    }),
  );
  check("a currency with no price is refused", brl.code === "credits_unavailable", brl);
  const euroPackInDollars = await failure(
    credits.createCheckout({
      user: OWNER,
      request: { credits: 167, currency: "usd" },
      target: "desktop",
      origin: ORIGIN,
    }),
  );
  check(
    "a pack size of another currency is refused",
    euroPackInDollars.status === 503 && euroPackInDollars.code === "credits_unavailable",
    euroPackInDollars,
  );
  check("refused checkouts open no Stripe page", stripe.sessions.length === 2, stripe.sessions.length);

  const paidPersonal = session("cs_1", OWNER.id, 10_000, 2_000);
  await deliver("checkout.session.completed", { ...paidPersonal, payment_status: "paid", payment_intent: "pi_owner" });
  await deliver("checkout.session.completed", { ...paidPersonal, payment_status: "paid", payment_intent: "pi_owner" });
  const afterPurchase = await state(OWNER.id);
  check(
    "a paid checkout adds the credits once, also when Stripe sends it again",
    afterPurchase.balance === 2_000 && purchaseStatus("cs_1") === "paid",
    afterPurchase,
  );

  const serverSession = session("cs_2", MEMBER.id, 1_000, 167, SERVER_ID);
  await deliver("checkout.session.completed", {
    ...serverSession,
    payment_status: "unpaid",
    payment_intent: "pi_member",
  });
  const pending = await state(OWNER.id);
  check(
    "a checkout that is not paid yet adds nothing",
    pending.servers[0]?.balance === 0 && purchaseStatus("cs_2") === "open",
    pending,
  );
  await deliver("checkout.session.async_payment_succeeded", {
    ...serverSession,
    payment_status: "paid",
    payment_intent: "pi_member",
  });
  const serverPaid = await state(OWNER.id);
  check(
    "a delayed payment for the server adds the credits to the server, not to the buyer",
    serverPaid.servers[0]?.balance === 167 && serverPaid.balance === 2_000 && (await state(MEMBER.id)).balance === 0,
    serverPaid,
  );

  await Effect.runPromise(
    credits.createCheckout({
      user: OWNER,
      request: { credits: 940, currency: "eur" },
      target: "desktop",
      origin: ORIGIN,
    }),
  );
  await deliver("checkout.session.expired", session("cs_3", OWNER.id, 5_000, 940));
  check(
    "an expired checkout is marked expired and adds nothing",
    purchaseStatus("cs_3") === "expired" && (await state(OWNER.id)).balance === 2_000,
  );

  const moved = await Effect.runPromise(
    credits.transfer(OWNER.id, { serverId: SERVER_ID, direction: "to_server", credits: 1_200 }),
  );
  check("the owner moves credits to the server", moved.balance === 800 && moved.servers[0]?.balance === 1_367, moved);
  const memberMove = await failure(
    credits.transfer(MEMBER.id, { serverId: SERVER_ID, direction: "to_personal", credits: 100 }),
  );
  check("a member cannot move server credits", memberMove.code === "credits_server_owner", memberMove);
  const tooMuch = await failure(
    credits.transfer(OWNER.id, { serverId: SERVER_ID, direction: "to_server", credits: 9_000 }),
  );
  const unchanged = await state(OWNER.id);
  check(
    "a move of more credits than the balance is refused and changes nothing",
    tooMuch.status === 409 &&
      tooMuch.code === "credits_not_enough" &&
      unchanged.balance === 800 &&
      unchanged.servers[0]?.balance === 1_367,
    { tooMuch, unchanged },
  );
  const back = await Effect.runPromise(
    credits.transfer(OWNER.id, { serverId: SERVER_ID, direction: "to_personal", credits: 200 }),
  );
  check(
    "the owner moves credits back from the server",
    back.balance === 1_000 && back.servers[0]?.balance === 1_167,
    back,
  );
  const tenthOut = await Effect.runPromise(
    credits.transfer(OWNER.id, { serverId: SERVER_ID, direction: "to_server", credits: 0.5 }),
  );
  const tenthBack = await Effect.runPromise(
    credits.transfer(OWNER.id, { serverId: SERVER_ID, direction: "to_personal", credits: 0.5 }),
  );
  check(
    "a move of half a credit keeps the tenth on both wallets",
    tenthOut.balance === 999.5 &&
      tenthOut.servers[0]?.balance === 1_167.5 &&
      tenthBack.balance === 1_000 &&
      tenthBack.servers[0]?.balance === 1_167,
    { tenthOut, tenthBack },
  );
  const transferRequest = (value: number) =>
    parseCreditTransferRequest({ serverId: SERVER_ID, direction: "to_server", credits: value });
  check(
    "a move request accepts tenths of a credit and refuses smaller parts",
    transferRequest(0.1)?.credits === 0.1 &&
      transferRequest(12.3)?.credits === 12.3 &&
      transferRequest(0.05) === null &&
      transferRequest(1.25) === null &&
      transferRequest(0) === null,
  );

  const together = await Promise.allSettled([
    Effect.runPromise(credits.transfer(OWNER.id, { serverId: SERVER_ID, direction: "to_server", credits: 600 })),
    Effect.runPromise(credits.transfer(OWNER.id, { serverId: SERVER_ID, direction: "to_server", credits: 600 })),
  ]);
  const afterRace = await state(OWNER.id);
  check(
    "two moves at the same time never take more credits than the balance",
    together.filter((result) => result.status === "fulfilled").length === 1 &&
      afterRace.balance === 400 &&
      afterRace.servers[0]?.balance === 1_767,
    afterRace,
  );

  const refund = {
    id: "re_half",
    object: "refund",
    status: "succeeded",
    payment_intent: "pi_owner",
    amount: 5_000,
    currency: "eur",
  };
  await deliver("refund.created", refund);
  await deliver("refund.updated", refund);
  const refunded = await state(OWNER.id);
  check(
    "a refund takes back its share of the credits once, but never more than the balance",
    refunded.balance === 0 && refunded.servers[0]?.balance === 1_767,
    refunded,
  );

  await deliver("charge.dispute.closed", {
    id: "dp_member",
    object: "dispute",
    status: "lost",
    payment_intent: "pi_member",
    amount: 1_000,
    currency: "eur",
  });
  const disputed = await state(OWNER.id);
  check("a lost dispute takes the credits back from the server", disputed.servers[0]?.balance === 1_600, disputed);

  const creditInvoice = (id: string, country: string, taxExempt: string) => ({
    id,
    object: "invoice",
    status: "paid",
    customer: `cus_${OWNER.id}`,
    currency: "eur",
    amount_paid: 11_900,
    total: 11_900,
    total_excluding_tax: 10_000,
    customer_tax_exempt: taxExempt,
    customer_address: { country },
    metadata: {
      [CREDIT_METADATA.kind]: CREDIT_METADATA_KIND,
      [CREDIT_METADATA.userId]: OWNER.id,
      [CREDIT_METADATA.credits]: "2000",
    },
  });
  const beforeInvoices = await state(OWNER.id);
  await deliver("invoice.paid", creditInvoice("in_credits_de", "DE", "none"));
  await deliver("invoice.paid", creditInvoice("in_credits_de", "DE", "none"));
  await deliver("invoice.paid", creditInvoice("in_credits_reverse", "FR", "reverse"));
  const afterInvoices = await state(OWNER.id);
  const ossRows = database.prepare("SELECT invoice_id, country, amount_eur FROM billing_vat_oss_sales").all();
  check(
    "a paid credit invoice of an EU consumer is one OSS sale without VAT, and a reverse-charge invoice is none",
    JSON.stringify(ossRows) === JSON.stringify([{ invoice_id: "in_credits_de", country: "DE", amount_eur: 10_000 }]),
    ossRows,
  );
  const salesFacts = database.prepare("SELECT COUNT(*) AS count FROM billing_sales_facts").get()?.count;
  check(
    "a credit invoice changes no wallet and writes no server or license sale",
    salesFacts === 0 && JSON.stringify(afterInvoices) === JSON.stringify(beforeInvoices),
    { salesFacts, beforeInvoices, afterInvoices },
  );

  const tracked = await creditEvents();
  check(
    "each checkout, purchase, expiry, move and reversal sends one credit event to the account that did it",
    JSON.stringify(countActions(tracked)) ===
      JSON.stringify({ checkout_started: 3, purchased: 2, checkout_expired: 1, moved: 5, reversed: 2 }) &&
      eventsOf(tracked, OWNER.id, {
        action: "checkout_started",
        wallet: "personal",
        credits: 2_000,
        currency: "eur",
        early_start: false,
      }).length === 1 &&
      eventsOf(tracked, MEMBER.id, { action: "checkout_started", wallet: "server", credits: 167, early_start: true })
        .length === 1 &&
      eventsOf(tracked, OWNER.id, { action: "purchased", wallet: "personal", credits: 2_000, amount: 10_000 })
        .length === 1 &&
      eventsOf(tracked, MEMBER.id, { action: "purchased", wallet: "server", credits: 167, currency: "eur" }).length ===
        1 &&
      eventsOf(tracked, OWNER.id, { action: "checkout_expired", wallet: "personal", credits: 940 }).length === 1 &&
      eventsOf(tracked, OWNER.id, { action: "moved", wallet: "server", direction: "to_server", credits: 1_200 })
        .length === 1 &&
      eventsOf(tracked, OWNER.id, { action: "moved", wallet: "personal", direction: "to_personal", credits: 0.5 })
        .length === 1 &&
      eventsOf(tracked, OWNER.id, { action: "reversed", wallet: "personal", credits: 400, amount: 5_000 }).length ===
        1 &&
      eventsOf(tracked, MEMBER.id, { action: "reversed", wallet: "server", credits: 167, amount: 1_000 }).length === 1,
    readable(tracked),
  );
  check(
    "credit events name no server, email, checkout or payment",
    keepsPrivate(tracked, [SERVER_ID, "@example.test", "cs_", "pi_", "re_", "dp_"]),
    readable(tracked),
  );

  const ledger = database
    .prepare("SELECT kind, COUNT(*) AS count FROM credit_ledger GROUP BY kind ORDER BY kind")
    .all();
  check(
    "the ledger has two purchases, six moves of two entries and two reversals",
    JSON.stringify(ledger) ===
      JSON.stringify([
        { kind: "purchase", count: 2 },
        { kind: "reversal", count: 2 },
        { kind: "transfer", count: 10 },
      ]),
    ledger,
  );
  const events = database.prepare("SELECT COUNT(*) AS count FROM billing_webhook_events").get()?.count;
  check("each delivered event is recorded once", events === sent(), { events, sent: sent() });
  const plans = database.prepare("SELECT COUNT(*) AS count FROM billing_subscriptions").get()?.count;
  check("credit checkouts make no server plan", plans === 0, plans);
  const trail = auditRows(database);
  const ledgerNotSpend = Number(
    database.prepare("SELECT COUNT(*) AS count FROM credit_ledger WHERE kind <> 'spend'").get()?.count,
  );
  check(
    "the credit audit has one row for each purchase, move and reversal in the ledger",
    trail.filter((row) => ["purchase", "transfer", "reversal"].includes(row.event) && row.result === "ok").length ===
      ledgerNotSpend &&
      audited(trail, { event: "purchase", user_id: OWNER.id, credits_tenths: 20_000, reference: "cs_1" }).length ===
        1 &&
      audited(trail, { event: "purchase", server_id: SERVER_ID, actor_user_id: MEMBER.id, credits_tenths: 1_670 })
        .length === 1,
    trail,
  );
  check(
    "the credit audit records each checkout that opens and each checkout that expires",
    audited(trail, { event: "checkout", result: "ok", user_id: OWNER.id, actor_user_id: OWNER.id, reference: "cs_1" })
      .length === 1 &&
      audited(trail, {
        event: "checkout",
        result: "ok",
        user_id: null,
        server_id: SERVER_ID,
        actor_user_id: MEMBER.id,
        credits_tenths: 1_670,
        reference: "cs_2",
      }).length === 1 &&
      audited(trail, { event: "checkout", result: "failed", code: "expired", reference: "cs_3", credits_tenths: 9_400 })
        .length === 1,
    trail,
  );
  check(
    "the credit audit records each refused checkout and move with its error code and the account",
    audited(trail, { event: "checkout", result: "failed", code: "credits_server_member", actor_user_id: OUTSIDER.id })
      .length === 1 &&
      audited(trail, { event: "checkout", result: "failed", code: "credits_unavailable", actor_user_id: OWNER.id })
        .length === 3 &&
      audited(trail, {
        event: "transfer",
        result: "failed",
        code: "credits_server_owner",
        actor_user_id: MEMBER.id,
        server_id: SERVER_ID,
        credits_tenths: 1_000,
      }).length === 1 &&
      audited(trail, { event: "transfer", result: "failed", code: "credits_not_enough", actor_user_id: OWNER.id })
        .length === 2,
    trail,
  );
  check(
    "the credit audit records a refund that could not take back all its credits",
    audited(trail, {
      event: "reversal",
      result: "failed",
      code: "credits_spent",
      user_id: OWNER.id,
      detail: JSON.stringify({ refunded_tenths: 10_000, reversed_tenths: 4_000 }),
    }).length === 1 && audited(trail, { event: "reversal", result: "failed" }).length === 1,
    trail,
  );
  check(
    "the credit audit has no email address",
    trail.every((row) => !JSON.stringify(row).includes("@example.test")),
    trail,
  );
  check(
    "credit flows call no other Stripe endpoint than the invoice lookup of the refund and dispute",
    stripe.unknown.length === 3 && stripe.unknown.every((call) => call === "GET /v1/invoice_payments"),
    stripe.unknown,
  );

  const dollars = await Effect.runPromise(
    credits.createCheckout({
      user: OUTSIDER,
      request: { credits: 145, currency: "usd" },
      target: "desktop",
      origin: ORIGIN,
    }),
  );
  const dollarForm = stripe.sessions.at(-1);
  check(
    "an account with no plan can pay in another offered currency",
    dollars.url.length > 0 &&
      dollarForm?.get("currency") === "usd" &&
      dollarForm.get("line_items[0][price]") === "price_1000" &&
      dollarForm.get(`metadata[${CREDIT_METADATA.credits}]`) === "145",
    dollarForm && Object.fromEntries(dollarForm),
  );
  database.exec(`
    INSERT INTO billing_subscriptions(stripe_subscription_id, user_id, stripe_customer_id, plan, interval, currency,
                                      status, updated_at)
    VALUES ('sub_usd', '${OUTSIDER.id}', 'cus_outsider', 'starter', 'month', 'usd', 'active', 1);
  `);
  const lockedView = await state(OUTSIDER.id);
  check(
    "an account with a plan sees only the currency of that plan",
    lockedView.available && lockedView.currency === "usd" && JSON.stringify(lockedView.currencies) === '["usd"]',
    lockedView,
  );
  const sessionsBeforeLock = stripe.sessions.length;
  const otherCurrency = await failure(
    credits.createCheckout({
      user: OUTSIDER,
      request: { credits: 167, currency: "eur" },
      target: "desktop",
      origin: ORIGIN,
    }),
  );
  check(
    "a checkout in another currency than the plan is refused and opens no Stripe page",
    otherCurrency.status === 409 &&
      otherCurrency.code === "credits_currency" &&
      stripe.sessions.length === sessionsBeforeLock,
    otherCurrency,
  );
  await deliver("checkout.session.completed", {
    ...session("cs_usd_wrong", OUTSIDER.id, 1_000, 167, undefined, "usd"),
    payment_status: "paid",
    payment_intent: "pi_usd_wrong",
  });
  const wrongPack = await state(OUTSIDER.id);
  await deliver("checkout.session.completed", {
    ...session("cs_usd", OUTSIDER.id, 1_000, 145, undefined, "usd"),
    payment_status: "paid",
    payment_intent: "pi_usd",
  });
  const dollarPack = await state(OUTSIDER.id);
  check(
    "a dollar payment adds the credits of the dollar pack and never the credits of the euro pack",
    wrongPack.balance === 0 && dollarPack.balance === 145,
    { wrongPack, dollarPack },
  );
  check(
    "the credit audit records a paid checkout that could not add credits",
    audited(auditRows(database), {
      event: "purchase",
      result: "failed",
      code: "target_invalid",
      reference: "cs_usd_wrong",
    }).length === 1,
    audited(auditRows(database), { result: "failed", event: "purchase" }),
  );

  const plane = await controlPlane(database);
  const ledgerRows = () => Number(database.prepare("SELECT COUNT(*) AS count FROM credit_ledger").get()?.count);
  const serverSum = (serverId: string) =>
    Number(
      database
        .prepare("SELECT COALESCE(SUM(amount_tenths), 0) / 10.0 AS total FROM credit_ledger WHERE server_id = ?")
        .get(serverId)?.total,
    );
  await Effect.runPromise(plane.removeOwnedHost(OWNER.id, SERVER_ID));
  const afterRemoval = await state(OWNER.id);
  const memberAfterRemoval = await state(MEMBER.id);
  check(
    "removing a server moves its credits to the owner, and the server leaves every list",
    afterRemoval.balance === 1_600 &&
      afterRemoval.servers.length === 0 &&
      memberAfterRemoval.servers.length === 0 &&
      memberAfterRemoval.balance === 0 &&
      serverSum(SERVER_ID) === 0,
    { afterRemoval, memberAfterRemoval },
  );
  const removedMove = await failure(
    credits.transfer(OWNER.id, { serverId: SERVER_ID, direction: "to_server", credits: 100 }),
  );
  check("the owner cannot move credits to a removed server", removedMove.code === "credits_server_owner", removedMove);
  const removedBuy = await failure(
    credits.createCheckout({
      user: OWNER,
      request: { credits: 167, currency: "eur", serverId: SERVER_ID },
      target: "desktop",
      origin: ORIGIN,
    }),
  );
  check("nobody can buy credits for a removed server", removedBuy.code === "credits_server_member", removedBuy);

  const late = session("cs_late", MEMBER.id, 1_000, 167, SERVER_ID);
  await deliver("checkout.session.completed", { ...late, payment_status: "paid", payment_intent: "pi_late" });
  check(
    "a payment for a server that was removed before the payment arrived gives the credits to the buyer",
    (await state(MEMBER.id)).balance === 167 && serverSum(SERVER_ID) === 0,
  );

  addOwnedServer(database, LAB_ID);
  await Effect.runPromise(credits.transfer(OWNER.id, { serverId: LAB_ID, direction: "to_server", credits: 400 }));
  await Effect.runPromise(plane.deleteHost(OWNER.id, LAB_ID));
  const afterDelete = await state(OWNER.id);
  check(
    "deleting a server moves its credits to the owner",
    afterDelete.balance === 1_600 &&
      afterDelete.servers.length === 0 &&
      serverSum(LAB_ID) === 0 &&
      database.prepare("SELECT 1 FROM remote_hosts WHERE host_id = ?").get(LAB_ID) === undefined,
    afterDelete,
  );

  addOwnedServer(database, EMPTY_ID);
  const rowsBefore = ledgerRows();
  await Effect.runPromise(plane.deleteHost(OWNER.id, EMPTY_ID));
  check("deleting a server with no credits writes no ledger entries", ledgerRows() === rowsBefore, {
    rowsBefore,
    rowsAfter: ledgerRows(),
  });

  const auditCount = () => Number(database.prepare("SELECT COUNT(*) AS count FROM credit_audit").get()?.count);
  const kept = auditCount();
  const now = Date.now();
  database
    .prepare(
      "INSERT INTO credit_audit(audit_id, created_at, event, result, code, user_id) VALUES (?, ?, 'transfer', 'failed', 'old', ?)",
    )
    .run("old-audit", now - CREDIT_AUDIT_RETENTION_MS - 1, OWNER.id);
  const pruned = await Effect.runPromise(new CreditAudit(sqliteD1(database), () => now).prune());
  check(
    "the credit audit deletes rows older than its retention and keeps the others",
    pruned === 1 && auditCount() === kept,
    { pruned, kept, after: auditCount() },
  );
}

async function holdsAndSpending() {
  const { database, credits, deliver, session, state, analytics, creditEvents } = await harness();
  const start = Date.now();
  let clock = start;
  const spending = new CreditSpending({ database: sqliteD1(database), now: () => clock, analytics });
  const run = <A>(effect: Effect.Effect<A, BillingError | BillingOperationError>) => Effect.runPromise(effect);
  const personal = { userId: OWNER.id };
  const server = { serverId: SERVER_ID };
  const hold = (jobId: string, amount: number, wallet: typeof personal | typeof server = personal, actor = OWNER.id) =>
    spending.hold({ jobId, wallet, actorUserId: actor, modelId: "seedance-2.5", credits: amount });
  const balance = async () => (await state(OWNER.id)).balance;
  const serverBalance = async () => (await state(OWNER.id)).servers[0]?.balance;

  await deliver("checkout.session.completed", {
    ...session("cs_h1", OWNER.id, 10_000, 2_000),
    payment_status: "paid",
    payment_intent: "pi_h1",
  });
  await run(credits.transfer(OWNER.id, { serverId: SERVER_ID, direction: "to_server", credits: 1_000 }));

  const first = await run(hold("job-1", 300));
  check(
    "a hold keeps the credits of a generation and the balance shows only the free credits",
    first.status === "held" && first.credits === 300 && first.userId === OWNER.id && (await balance()) === 700,
    first,
  );
  const again = await run(hold("job-1", 300));
  check(
    "the same hold sent again keeps the credits once",
    again.jobId === "job-1" && again.status === "held" && (await balance()) === 700,
  );
  const conflict = await failure(hold("job-1", 301));
  check("a job id that is used for other credits is refused", conflict.code === "credits_job_conflict", conflict);
  const tooBig = await failure(hold("job-big", 800));
  check(
    "a hold of more credits than the free balance is refused and keeps nothing",
    tooBig.status === 409 && tooBig.code === "credits_spend_not_enough" && (await balance()) === 700,
    tooBig,
  );
  const race = await Promise.allSettled([run(hold("job-r1", 500)), run(hold("job-r2", 500))]);
  const winner = race.find((result) => result.status === "fulfilled");
  check(
    "two holds at the same time never keep more credits than the free balance",
    race.filter((result) => result.status === "fulfilled").length === 1 && (await balance()) === 200,
    race.map((result) => result.status),
  );

  const memberHold = await run(hold("job-s1", 400, server, MEMBER.id));
  check(
    "a member can hold credits of the server",
    memberHold.serverId === SERVER_ID && memberHold.actorUserId === MEMBER.id && (await serverBalance()) === 600,
    memberHold,
  );
  const outsider = await failure(hold("job-o", 10, server, OUTSIDER.id));
  const otherWallet = await failure(hold("job-m", 10, personal, MEMBER.id));
  check(
    "an account that is not a member cannot use server credits, and nobody can use the credits of another account",
    outsider.code === "credits_spend_member" && otherWallet.code === "credits_spend_member",
    { outsider, otherWallet },
  );
  const heldMove = await failure(
    credits.transfer(OWNER.id, { serverId: SERVER_ID, direction: "to_personal", credits: 700 }),
  );
  check(
    "a move cannot take credits that a hold keeps",
    heldMove.code === "credits_not_enough" && (await serverBalance()) === 600,
    heldMove,
  );

  const started = await run(spending.start("job-1", "p-1"));
  const charged = await run(spending.settle("job-1", { outcome: "completed" }));
  const grantSearches = settledGrantSearches(database);
  check(
    "a settled generation reads only the grants of its own account and server",
    grantSearches.includes("credit_grants_user") &&
      grantSearches.includes("credit_grants_server") &&
      !grantSearches.includes("credit_grants_due"),
    grantSearches,
  );
  const chargedAgain = await run(spending.settle("job-1", { outcome: "failed" }));
  const spendRows = () =>
    database
      .prepare(
        "SELECT entry_id, amount_tenths / 10.0 AS amount FROM credit_ledger WHERE kind = 'spend' ORDER BY entry_id",
      )
      .all();
  check(
    "a completed generation charges the held credits once, and a later result does not change it",
    started?.providerJobId === "p-1" &&
      charged?.status === "charged" &&
      charged.charged === 300 &&
      chargedAgain?.status === "charged" &&
      chargedAgain.outcome === "completed" &&
      JSON.stringify(spendRows()) === JSON.stringify([{ entry_id: "spend:job-1", amount: -300 }]) &&
      (await balance()) === 200,
    { charged, chargedAgain, spend: spendRows() },
  );
  const winnerId = winner?.status === "fulfilled" ? winner.value.jobId : "";
  const failed = await run(spending.settle(winnerId, { outcome: "failed" }));
  check(
    "a failed generation uses no credits",
    failed?.status === "released" &&
      failed.outcome === "failed" &&
      failed.charged === null &&
      (await balance()) === 700,
    failed,
  );
  await run(hold("job-p", 200));
  const partial = await run(spending.settle("job-p", { outcome: "completed", charged: 120 }));
  await run(hold("job-x", 50));
  const capped = await run(spending.settle("job-x", { outcome: "completed", charged: 500 }));
  check(
    "a completed generation charges its real price, never more than the hold",
    partial?.charged === 120 && capped?.charged === 50 && (await balance()) === 530,
    { partial, capped },
  );
  await run(hold("job-c", 100));
  const canceled = await run(spending.settle("job-c", { outcome: "canceled" }));
  await run(hold("job-f", 100));
  const refused = await run(spending.settle("job-f", { outcome: "refused" }));
  check(
    "a canceled or refused generation uses no credits",
    canceled?.status === "released" && refused?.status === "released" && (await balance()) === 530,
    { canceled, refused },
  );
  check(
    "a result for an unknown job changes nothing",
    (await run(spending.settle("job-none", { outcome: "completed" }))) === null,
  );

  await run(hold("job-h", 400));
  const refund = {
    id: "re_h1",
    object: "refund",
    status: "succeeded",
    payment_intent: "pi_h1",
    amount: 10_000,
    currency: "eur",
  };
  await deliver("refund.created", refund);
  const afterRefund = await balance();
  const heldCharge = await run(spending.settle("job-h", { outcome: "completed" }));
  const personalLedger = () =>
    Number(
      database
        .prepare("SELECT COALESCE(SUM(amount_tenths), 0) / 10.0 AS total FROM credit_ledger WHERE user_id = ?")
        .get(OWNER.id)?.total,
    );
  check(
    "a refund cannot take credits that a hold keeps, so the generation can still be charged",
    afterRefund === 0 && heldCharge?.charged === 400 && personalLedger() === 0,
    { afterRefund, heldCharge, ledger: personalLedger() },
  );

  const outcomes: Readonly<Record<string, CreditJobCheck>> = {
    "p-b": { status: "running" },
    "p-c2": { status: "completed" },
    "p-e": { status: "failed" },
    "p-s1": { status: "running" },
  };
  const calls: string[] = [];
  const checker = (providerJobId: string) => {
    calls.push(providerJobId);
    const outcome = outcomes[providerJobId];
    return outcome ? Effect.succeed(outcome) : Effect.fail(new BillingError(502, "provider_down", "down"));
  };
  for (const job of ["job-a", "job-b", "job-c2", "job-d", "job-e"]) await run(hold(job, 50, server, MEMBER.id));
  for (const job of ["b", "c2", "d", "e"]) await run(spending.start(`job-${job}`, `p-${job}`));
  await run(spending.start("job-s1", "p-s1"));
  clock = start + Math.max(CREDIT_HOLD_START_GRACE_MS, CREDIT_HOLD_FIRST_CHECK_MS) + 60_000;
  const sweep = await run(spending.sweep(checker));
  const swept = async (jobId: string) => (await run(spending.find(jobId)))?.outcome;
  check(
    "the sweep frees a hold that never started, charges a completed job, frees a failed job, and checks a running or unknown job again later",
    JSON.stringify(sweep) === JSON.stringify({ abandoned: 1, settled: 2, rechecked: 3, expired: 0 }) &&
      (await swept("job-a")) === "abandoned" &&
      (await swept("job-c2")) === "completed" &&
      (await swept("job-e")) === "failed" &&
      (await swept("job-b")) === null &&
      (await swept("job-d")) === null &&
      (await serverBalance()) === 450,
    { sweep, calls },
  );
  const callsBefore = calls.length;
  clock += 60_000;
  const quiet = await run(spending.sweep(checker));
  check(
    "a job that is still running is not checked again before its next check time",
    calls.length === callsBefore && quiet.rechecked === 0 && quiet.settled === 0,
    { quiet, calls },
  );

  await creditActivity(database, credits);

  const plane = await controlPlane(database);
  await Effect.runPromise(plane.removeOwnedHost(OWNER.id, SERVER_ID));
  const moved = await run(spending.find("job-s1"));
  check(
    "removing a server moves its free and held credits to the owner, and the open holds follow",
    moved?.userId === OWNER.id && moved.serverId === null && moved.status === "held" && (await balance()) === 450,
    { moved, balance: await balance() },
  );
  const removed = await failure(hold("job-gone", 10, server, MEMBER.id));
  check("nobody can hold credits of a removed server", removed.code === "credits_spend_member", removed);
  const ownerCharge = await run(spending.settle("job-s1", { outcome: "completed" }));
  check(
    "a job that completes after its server was removed charges the owner",
    ownerCharge?.charged === 400 && (await balance()) === 450,
    ownerCharge,
  );

  clock = start + CREDIT_HOLD_LIMIT_MS + 60_000;
  const late = await run(spending.sweep(checker));
  check(
    "a job that runs past the time limit is freed and uses no credits, and a job that cannot be checked stays held",
    late.expired === 1 &&
      (await swept("job-b")) === "expired" &&
      (await swept("job-d")) === null &&
      (await balance()) === 500,
    late,
  );
  clock = start + 2 * CREDIT_HOLD_LIMIT_MS + 60_000;
  const ceiling = await run(spending.sweep(checker));
  check(
    "a job that cannot be checked is freed one time limit after its own limit",
    ceiling.expired === 1 && (await swept("job-d")) === "expired" && (await balance()) === 550,
    ceiling,
  );
  const lateStart = await run(spending.start("job-a", "p-a-late"));
  check(
    "a job that starts after its hold was freed keeps the freed state, so the caller cancels it",
    lateStart?.status === "released" && lateStart.providerJobId === "p-a-late",
    lateStart,
  );

  const negative = database
    .prepare(
      `SELECT wallet, SUM(amount) AS ledger, (SELECT COALESCE(SUM(credits_tenths), 0) FROM credit_holds h
               WHERE COALESCE(h.user_id, h.server_id) = wallet AND h.status = 'held') AS held
         FROM (SELECT COALESCE(user_id, server_id) AS wallet, amount_tenths AS amount FROM credit_ledger)
        GROUP BY wallet HAVING ledger < 0 OR ledger - held < 0`,
    )
    .all();
  check("no wallet has fewer credits than zero or than its holds", negative.length === 0, negative);
  check("each completed generation has one charge in the ledger", spendRows().length === 6, spendRows());

  const media = (await creditEvents()).filter((event) => String(event.properties.get("action")).startsWith("media_"));
  check(
    "each generation sends one start, and one charge or release, with the model and the outcome",
    JSON.stringify(countActions(media)) === JSON.stringify({ media_started: 6, media_charged: 6, media_released: 7 }) &&
      media.every((event) => event.properties.get("model_id") === "seedance-2.5") &&
      eventsOf(media, OWNER.id, {
        action: "media_charged",
        wallet: "personal",
        credits: 300,
        credits_held: 300,
        outcome: "completed",
      }).length === 1 &&
      eventsOf(media, OWNER.id, { action: "media_charged", credits: 120, credits_held: 200 }).length === 1 &&
      eventsOf(media, OWNER.id, { action: "media_released", credits: 100, outcome: "refused" }).length === 1 &&
      eventsOf(media, MEMBER.id, { action: "media_released", wallet: "server", credits: 50, outcome: "abandoned" })
        .length === 1 &&
      eventsOf(media, MEMBER.id, { action: "media_released", outcome: "expired" }).length === 2 &&
      eventsOf(media, MEMBER.id, { action: "media_started", wallet: "server", credits: 400 }).length === 1,
    readable(media),
  );
  check(
    "generation events name no server or job",
    keepsPrivate(media, [SERVER_ID, "job-", "p-1", "p-a-late"]),
    readable(media),
  );
  const holdTrail = auditRows(database);
  check(
    "the credit audit has one row for each hold, start, charge and release",
    audited(holdTrail, { event: "started" }).length === 6 &&
      audited(holdTrail, { event: "charged" }).length === 6 &&
      audited(holdTrail, { event: "released" }).length === 7 &&
      audited(holdTrail, { event: "hold" }).length ===
        Number(database.prepare("SELECT COUNT(*) AS count FROM credit_holds").get()?.count),
    holdTrail,
  );
  check(
    "the credit audit keeps the outcome, model and charged credits of each generation",
    audited(holdTrail, {
      event: "charged",
      result: "ok",
      code: "completed",
      user_id: OWNER.id,
      credits_tenths: 1_200,
      model_id: "seedance-2.5",
      reference: "job-p",
    }).length === 1 &&
      audited(holdTrail, { event: "released", result: "failed", code: "refused", reference: "job-f" }).length === 1 &&
      audited(holdTrail, {
        event: "released",
        result: "failed",
        code: "abandoned",
        server_id: SERVER_ID,
        actor_user_id: MEMBER.id,
        reference: "job-a",
      }).length === 1 &&
      audited(holdTrail, { event: "started", reference: "job-a" }).length === 0,
    holdTrail,
  );

  addOwnedServer(database, LAB_ID);
  await run(credits.transfer(OWNER.id, { serverId: LAB_ID, direction: "to_server", credits: 100 }));
  await run(
    spending.hold({ jobId: "job-host", wallet: { serverId: LAB_ID }, actorUserId: null, modelId: "m", credits: 60 }),
  );
  await run(spending.start("job-host", "p-host"));
  await run(spending.settle("job-host", { outcome: "completed", charged: 40 }));
  const hostPaid = (await creditEvents()).filter((event) => event.properties.get("model_id") === "m");
  check(
    "a generation that the server pays with no member counts for the server owner",
    hostPaid.length === 2 &&
      hostPaid.every((event) => event.profileId === OWNER.id && event.properties.get("wallet") === "server") &&
      eventsOf(hostPaid, OWNER.id, { action: "media_charged", credits: 40, credits_held: 60 }).length === 1,
    readable(hostPaid),
  );
}

async function creditActivity(database: DatabaseSync, credits: CreditService) {
  database.prepare("UPDATE users SET name = ? WHERE id = ?").run("Maya Member", MEMBER.id);
  database
    .prepare(
      `INSERT INTO credit_media_models(model_id, upstream_id, kind, name, maker, updated_at)
       VALUES ('seedance-2.5', 'upstream/seedance', 'video', 'Seedance 2.5', 'ByteDance', 1)`,
    )
    .run();
  const activity = (userId: string) => Effect.runPromise(credits.activity(userId));
  const owner = await activity(OWNER.id);
  const member = await activity(MEMBER.id);
  const outsider = await activity(OUTSIDER.id);
  const entry = (id: string) => owner.entries.find((item) => item.id === id);
  const kinds = (entries: readonly CreditActivityEntry[], kind: CreditActivityEntry["kind"], serverId?: string) =>
    entries.filter((item) => item.kind === kind && item.serverId === serverId);
  const personalMove = kinds(owner.entries, "move")[0];
  const serverMove = kinds(owner.entries, "move", SERVER_ID)[0];
  check(
    "the activity shows purchases, moves on both sides and refunds of the owner",
    kinds(owner.entries, "purchase").some((item) => item.credits === 2_000 && item.actor === "you") &&
      personalMove?.credits === -1_000 &&
      personalMove.otherServerId === SERVER_ID &&
      serverMove?.credits === 1_000 &&
      serverMove.otherServerId === undefined &&
      kinds(owner.entries, "refund").length === 1,
    { personalMove, serverMove },
  );
  const charged = entry("hold:job-1");
  const partial = entry("hold:job-p");
  const canceled = entry("hold:job-c");
  const refused = entry("hold:job-f");
  const running = entry("hold:job-s1");
  check(
    "a generation shows its model, its charged credits, and its status when it runs, fails or is canceled",
    charged?.kind === "generation" &&
      charged.credits === -300 &&
      charged.status === undefined &&
      charged.modelName === "Seedance 2.5" &&
      charged.maker === "ByteDance" &&
      partial?.credits === -120 &&
      canceled?.status === "canceled" &&
      canceled.credits === 0 &&
      refused?.status === "failed" &&
      refused.credits === 0 &&
      running?.status === "running" &&
      running.credits === -400 &&
      running.serverId === SERVER_ID,
    { charged, partial, canceled, refused, running },
  );
  check(
    "a server owner sees the name of the member who used server credits, and no email",
    running?.actor === "member" &&
      running.actorName === "Maya Member" &&
      !JSON.stringify([owner, member]).includes("@"),
    running,
  );
  check(
    "the activity has no spend rows, so a charged generation shows once",
    owner.entries.every((item) => !item.id.startsWith("spend:")) &&
      owner.entries.filter((item) => item.id === "hold:job-1").length === 1,
  );
  check(
    "a member sees only the server activity that the member started",
    member.entries.length > 0 &&
      member.entries.every((item) => item.serverId === SERVER_ID && item.actor === "you") &&
      member.entries.some((item) => item.id === "hold:job-s1") &&
      !member.entries.some((item) => item.kind === "move"),
    member.entries.map((item) => item.id),
  );
  check("an account that is not a member sees no activity", outsider.entries.length === 0, outsider);
  const setActor = database.prepare("UPDATE credit_holds SET actor_user_id = ? WHERE job_id = 'job-s1'");
  setActor.run(null);
  const afterDelete = (await activity(OWNER.id)).entries.find((item) => item.id === "hold:job-s1");
  setActor.run(MEMBER.id);
  const refund = kinds(owner.entries, "refund")[0];
  check(
    "a generation of a deleted account shows a member, and only OpenBot entries show OpenBot",
    afterDelete?.actor === "member" &&
      afterDelete.actorName === undefined &&
      refund?.actor === "openbot" &&
      serverMove?.actor === "you",
    { afterDelete, refund },
  );
  const ordered = owner.entries.every((item, index, all) => index === 0 || (all[index - 1]?.at ?? 0) >= item.at);
  check(
    "the activity is newest first, has a limit, and the client contract accepts it",
    ordered &&
      owner.entries.length <= CREDIT_ACTIVITY_LIMIT &&
      parseCreditActivity(JSON.parse(JSON.stringify(owner))) !== null,
    owner.entries.length,
  );
}

async function holdLimits() {
  const { database, deliver, session, state } = await harness();
  const start = Date.now();
  let clock = start;
  const spending = new CreditSpending({ database: sqliteD1(database), now: () => clock });
  const run = <A>(effect: Effect.Effect<A, BillingError | BillingOperationError>) => Effect.runPromise(effect);
  const balance = async () => (await state(OWNER.id)).balance;
  const find = async (jobId: string) => run(spending.find(jobId));
  await deliver("checkout.session.completed", {
    ...session("cs_l1", OWNER.id, 10_000, 2_000),
    payment_status: "paid",
    payment_intent: "pi_l1",
  });
  const outcomes: Record<string, CreditJobCheck> = { "p-done": { status: "running" }, "p-run": { status: "running" } };
  const checker = (providerJobId: string) => {
    const outcome = outcomes[providerJobId];
    return outcome ? Effect.succeed(outcome) : Effect.fail(new BillingError(502, "provider_down", "down"));
  };
  for (const job of ["sent", "done", "run", "down"]) {
    await run(
      spending.hold({
        jobId: `job-${job}`,
        wallet: { userId: OWNER.id },
        actorUserId: OWNER.id,
        modelId: "seedance-2.5",
        credits: 50,
      }),
    );
    await run(
      spending.claimSubmit(`job-${job}`, { upstream: "router", model: "up-video-1", params: "{}", fields: "{}" }),
    );
  }
  for (const job of ["done", "run", "down"]) await run(spending.start(`job-${job}`, `p-${job}`));

  clock = start + CREDIT_HOLD_START_GRACE_MS + 60_000;
  const early = await run(spending.sweep(checker));
  check(
    "a hold whose request went to the processor stays held when no job id came back",
    early.abandoned === 0 && (await find("job-sent"))?.status === "held" && (await balance()) === 1_800,
    early,
  );

  clock = start + CREDIT_HOLD_LIMIT_MS - 30 * 60_000;
  await run(spending.sweep(checker));
  outcomes["p-done"] = { status: "completed" };
  clock = start + CREDIT_HOLD_LIMIT_MS + 60_000;
  const limit = await run(spending.sweep(checker));
  const [sent, done, running, down] = await Promise.all(
    ["sent", "done", "run", "down"].map((job) => find(`job-${job}`)),
  );
  check(
    "at the time limit the sweep checks each started job first: a completed job is charged, a running job is freed, and a job that cannot be checked stays held",
    limit.settled === 1 &&
      limit.expired === 2 &&
      done?.status === "charged" &&
      running?.outcome === "expired" &&
      sent?.outcome === "expired" &&
      down?.status === "held" &&
      (await balance()) === 1_900,
    { limit, sent, done, running, down },
  );

  clock = start + 2 * CREDIT_HOLD_LIMIT_MS + 60_000;
  const ceiling = await run(spending.sweep(checker));
  check(
    "a job that still cannot be checked is freed one time limit after its own limit",
    ceiling.expired === 1 && (await find("job-down"))?.outcome === "expired" && (await balance()) === 1_950,
    ceiling,
  );
}

const DAY_MS = 24 * 60 * 60 * 1_000;

interface GrantRow {
  grant_id: string;
  user_id: string | null;
  server_id: string | null;
  credits: number;
  remaining: number;
  starts_at: number;
  expires_at: number;
  status: string;
}

async function freeMonthlyCredits() {
  const march31 = Date.UTC(2027, 2, 31, 9);
  const shortMonth = licenseCreditSlot(march31, "month", Date.UTC(2027, 2, 15));
  const yearInFebruary = licenseCreditSlot(Date.UTC(2027, 0, 31, 9), "year", Date.UTC(2026, 1, 28, 12));
  check(
    "a monthly slot that starts in a short month starts on its last day, and a yearly license has 12 slots",
    shortMonth?.startsAt === Date.UTC(2027, 1, 28, 9) &&
      shortMonth.expiresAt === march31 &&
      yearInFebruary?.startsAt === Date.UTC(2026, 1, 28, 9) &&
      yearInFebruary.expiresAt === Date.UTC(2026, 2, 31, 9) &&
      licenseCreditSlot(march31, "month", march31) === null,
    { shortMonth, yearInFebruary },
  );
  const { database, credits, deliver, session, state, analytics, creditEvents } = await harness();
  const start = Date.now();
  let clock = start;
  const d1 = sqliteD1(database);
  const grants = new CreditGrants({ database: d1, now: () => clock, analytics });
  const spending = new CreditSpending({ database: d1, now: () => clock });
  const run = <A>(effect: Effect.Effect<A, BillingError | BillingOperationError>) => Effect.runPromise(effect);
  const teamEnd = start + 20 * DAY_MS;
  const yearEnd = start + 300 * DAY_MS;
  const license = (
    id: string,
    user: string,
    status: string,
    tier: string,
    users: number,
    interval: string,
    end: number,
  ) =>
    database
      .prepare(
        `INSERT INTO licenses(stripe_subscription_id, user_id, stripe_customer_id, users, currency, status,
           current_period_end, cancel_at_period_end, tier, billing_interval, bundle, updated_at)
         VALUES (?, ?, ?, ?, 'eur', ?, ?, 0, ?, ?, 0, 1)`,
      )
      .run(id, user, `cus_${user}`, users, status, end, tier, interval);
  license("sub_trial", MEMBER.id, "trialing", "starter", 1, "month", start + 10 * DAY_MS);
  license("sub_team", OWNER.id, "active", "team", 3, "month", teamEnd);
  license("sub_year", OUTSIDER.id, "active", "starter", 1, "year", yearEnd);
  const grantRows = async (user: string) =>
    (
      await d1
        .prepare(
          "SELECT grant_id, user_id, server_id, credits_tenths / 10.0 AS credits, remaining_tenths / 10.0 AS remaining, starts_at, expires_at, status FROM credit_grants WHERE (user_id = ?1 OR server_id = ?1) AND scope = 'all' ORDER BY created_at, grant_id",
        )
        .bind(user)
        .all<GrantRow>()
    ).results;

  const first = await run(grants.sweep());
  const team = (await grantRows(OWNER.id))[0];
  const year = (await grantRows(OUTSIDER.id))[0];
  check(
    "a paid license gives free credits to its owner, and a trial gives none",
    first.issued === 2 && (await grantRows(MEMBER.id)).length === 0 && team !== undefined && year !== undefined,
    { first, team, year },
  );
  check(
    "a Team license with 3 users gives 200 credits for its current month",
    team?.credits === 200 && team.expires_at === teamEnd && team.expires_at - team.starts_at >= 28 * DAY_MS,
    team,
  );
  check(
    "a yearly Starter license gives 50 credits for the current month of the year, not the whole year",
    year?.credits === 50 &&
      year.starts_at <= start &&
      year.expires_at > start &&
      year.expires_at - year.starts_at <= 31 * DAY_MS &&
      year.expires_at < yearEnd,
    year,
  );
  const repeat = await run(grants.sweep());
  check(
    "a second sweep in the same month gives nothing more",
    repeat.issued === 0 && repeat.expired === 0 && (await state(OWNER.id)).balance === 200,
    repeat,
  );
  const shown = await state(OWNER.id);
  check(
    "the credits state shows how many free credits expire and when",
    shown.expiring?.credits === 200 && shown.expiring.expiresAt === teamEnd,
    shown.expiring,
  );

  await deliver("checkout.session.completed", {
    ...session("cs_g1", OWNER.id, 10_000, 2_000),
    payment_status: "paid",
    payment_intent: "pi_g1",
  });
  await run(
    spending.hold({ jobId: "job-g1", wallet: { userId: OWNER.id }, actorUserId: OWNER.id, modelId: "m", credits: 150 }),
  );
  await run(spending.settle("job-g1", { outcome: "completed" }));
  await run(spending.settle("job-g1", { outcome: "completed" }));
  check(
    "a generation uses free credits first, once",
    (await grantRows(OWNER.id))[0]?.remaining === 50 && (await state(OWNER.id)).balance === 2_050,
    await grantRows(OWNER.id),
  );

  await run(credits.transfer(OWNER.id, { serverId: SERVER_ID, direction: "to_server", credits: 30 }));
  const moved = (await grantRows(SERVER_ID))[0];
  const afterMove = await state(OWNER.id);
  check(
    "moving credits to a server moves free credits first and keeps their end date",
    moved?.credits === 30 &&
      moved.server_id === SERVER_ID &&
      moved.expires_at === teamEnd &&
      (await grantRows(OWNER.id))[0]?.remaining === 20 &&
      afterMove.servers[0]?.expiring?.credits === 30 &&
      afterMove.expiring?.credits === 20,
    { moved, afterMove },
  );

  await run(
    spending.hold({
      jobId: "job-open",
      wallet: { userId: OWNER.id },
      actorUserId: OWNER.id,
      modelId: "m",
      credits: 10,
    }),
  );
  clock = Math.max(teamEnd, year?.expires_at ?? teamEnd) + 60_000;
  const expiry = await run(grants.sweep());
  const waiting = (await grantRows(OWNER.id)).find((row) => row.user_id === OWNER.id && row.status === "active");
  check(
    "free credits wait for a job that started before their end",
    waiting?.remaining === 20 && (await grantRows(SERVER_ID))[0]?.status === "expired",
    { expiry, waiting },
  );
  const overdue = await failure(
    spending.hold({
      jobId: "job-late",
      wallet: { userId: OWNER.id },
      actorUserId: OWNER.id,
      modelId: "m",
      credits: 1_995,
    }),
  );
  check("a new job cannot use free credits after their end", overdue.code === "credits_spend_not_enough", overdue);
  await run(
    spending.hold({
      jobId: "job-new",
      wallet: { userId: OWNER.id },
      actorUserId: OWNER.id,
      modelId: "m",
      credits: 100,
    }),
  );
  await run(spending.settle("job-new", { outcome: "completed" }));
  const untouched = (await grantRows(OWNER.id)).find((row) => row.user_id === OWNER.id && row.status === "active");
  check(
    "a job that started after the end of free credits pays with bought credits",
    untouched?.remaining === 20,
    untouched,
  );
  await run(spending.settle("job-open", { outcome: "failed" }));
  const released = await run(grants.sweep());
  const after = await state(OWNER.id);
  const nextYear = await grantRows(OUTSIDER.id);
  check(
    "at the end of the month unused free credits expire, also the credits that a released job held",
    after.balance === 1_900 && after.servers[0]?.balance === 0 && after.expiring === undefined,
    { released, after },
  );
  check(
    "bought credits never expire",
    database
      .prepare(
        "SELECT COALESCE(SUM(amount_tenths), 0) / 10.0 AS total FROM credit_ledger WHERE kind = 'expiry' AND (user_id = ? OR server_id = ?)",
      )
      .get(OWNER.id, SERVER_ID)?.total === -50,
  );
  check(
    "a yearly license starts the next month's credits when the last ones end, and a license that is not renewed gets none",
    nextYear.length === 2 &&
      nextYear[0]?.status === "expired" &&
      nextYear[1]?.starts_at === nextYear[0]?.expires_at &&
      nextYear[1]?.credits === 50 &&
      (await grantRows(OWNER.id)).filter((row) => row.user_id === OWNER.id && row.status === "active").length === 0,
    { expiry, nextYear },
  );

  const renewedEnd = teamEnd + 31 * DAY_MS;
  database
    .prepare("UPDATE licenses SET current_period_end = ? WHERE stripe_subscription_id = 'sub_team'")
    .run(renewedEnd);
  const renewed = await run(grants.issue("sub_team"));
  const renewal = (await grantRows(OWNER.id)).find((row) => row.status === "active" && row.user_id === OWNER.id);
  check(
    "a renewed license gives the credits of the new month",
    renewed === 1 && renewal?.credits === 200 && renewal.expires_at === renewedEnd,
    renewal,
  );

  const grantEvents = (await creditEvents()).filter((event) =>
    String(event.properties.get("action")).startsWith("grant"),
  );
  check(
    "each free credit grant and each expiry of unused free credits sends one event, and a server's expiry counts for its owner",
    JSON.stringify(countActions(grantEvents)) === JSON.stringify({ granted: 4, grant_expired: 3 }) &&
      eventsOf(grantEvents, OWNER.id, { action: "granted", wallet: "personal", credits: 200 }).length === 2 &&
      eventsOf(grantEvents, OUTSIDER.id, { action: "granted", wallet: "personal", credits: 50 }).length === 2 &&
      eventsOf(grantEvents, OWNER.id, { action: "grant_expired", wallet: "server", credits: 30 }).length === 1 &&
      eventsOf(grantEvents, OWNER.id, { action: "grant_expired", wallet: "personal", credits: 20 }).length === 1 &&
      eventsOf(grantEvents, OUTSIDER.id, { action: "grant_expired", wallet: "personal", credits: 50 }).length === 1 &&
      keepsPrivate(grantEvents, [SERVER_ID, "sub_"]),
    readable(grantEvents),
  );

  await run(credits.transfer(OWNER.id, { serverId: SERVER_ID, direction: "to_server", credits: 40 }));
  const plane = await controlPlane(database);
  await Effect.runPromise(plane.removeOwnedHost(OWNER.id, SERVER_ID));
  const back = (await grantRows(OWNER.id)).filter((row) => row.status === "active");
  check(
    "removing a server gives its free credits back to the owner with the same end date",
    back.length === 2 &&
      back.every((row) => row.user_id === OWNER.id && row.server_id === null && row.expires_at === renewedEnd) &&
      back.reduce((sum, row) => sum + row.remaining, 0) === 200,
    back,
  );
}

async function welcomeCredits() {
  const { database, credits, deliver, session, state, analytics, creditEvents } = await harness("unissued");
  const spending = new CreditSpending({ database: sqliteD1(database), now: () => Date.now(), analytics });
  const run = <A>(effect: Effect.Effect<A, BillingError | BillingOperationError>) => Effect.runPromise(effect);
  const hold = (jobId: string, amount: number, welcome: boolean, wallet: CreditWallet = { userId: OWNER.id }) =>
    spending.hold({ jobId, wallet, actorUserId: OWNER.id, modelId: "image-model", credits: amount, welcome });
  const welcomeGrant = () =>
    database
      .prepare(
        "SELECT credits_tenths / 10.0 AS credits, remaining_tenths / 10.0 AS remaining, status FROM credit_grants WHERE grant_id = ?",
      )
      .get(`welcome:${OWNER.id}`);
  const ledgerRows = () =>
    database
      .prepare("SELECT kind, amount_tenths / 10.0 AS amount FROM credit_ledger WHERE user_id = ? ORDER BY entry_id")
      .all(OWNER.id);

  const first = await state(OWNER.id);
  const second = await state(OWNER.id);
  const granted = eventsOf(await creditEvents(), OWNER.id, { action: "granted", wallet: "personal", credits: 10 });
  check(
    "a new account gets 10 free credits once, with one ledger entry and one event",
    first.balance === 10 &&
      first.welcome === 10 &&
      first.expiring === undefined &&
      second.balance === 10 &&
      second.welcome === 10 &&
      JSON.stringify(ledgerRows()) === JSON.stringify([{ kind: "grant", amount: 10 }]) &&
      granted.length === 1,
    { first, second, ledger: ledgerRows(), granted: granted.length },
  );

  const paidOnly = await failure(hold("w-paid", 2, false));
  const move = await failure(credits.transfer(OWNER.id, { serverId: SERVER_ID, direction: "to_server", credits: 5 }));
  const serverHold = await failure(hold("w-server", 2, true, { serverId: SERVER_ID }));
  check(
    "free credits cannot pay a model without free use, a move to a server, or a server generation",
    paidOnly.code === "credits_spend_not_enough" &&
      move.code === "credits_not_enough" &&
      serverHold.code === "credits_spend_not_enough" &&
      (await state(OWNER.id)).welcome === 10,
    { paidOnly, move, serverHold },
  );

  const free = await run(hold("w-1", 4.5, true));
  const whileHeld = await state(OWNER.id);
  await run(spending.settle("w-1", { outcome: "completed" }));
  const afterFree = await state(OWNER.id);
  check(
    "a model with free use holds and charges the free credits",
    free.funding === "welcome" &&
      whileHeld.balance === 5.5 &&
      whileHeld.welcome === 5.5 &&
      afterFree.balance === 5.5 &&
      afterFree.welcome === 5.5 &&
      JSON.stringify(welcomeGrant()) === JSON.stringify({ credits: 10, remaining: 5.5, status: "active" }),
    { free, whileHeld, afterFree, grant: welcomeGrant() },
  );

  await deliver("checkout.session.completed", {
    ...session("cs_w1", OWNER.id, 10_000, 2_000),
    payment_status: "paid",
    payment_intent: "pi_w1",
  });
  const tooBigForFree = await run(hold("w-2", 8.5, true));
  await run(spending.settle("w-2", { outcome: "completed" }));
  const paidHold = await run(hold("w-3", 20, false));
  await run(spending.settle("w-3", { outcome: "completed" }));
  const afterPaid = await state(OWNER.id);
  check(
    "a hold that the free credits cannot cover uses paid credits, and paid generations keep the free credits",
    tooBigForFree.funding === "paid" &&
      paidHold.funding === "paid" &&
      afterPaid.balance === 2_000 - 8.5 - 20 + 5.5 &&
      afterPaid.welcome === 5.5 &&
      JSON.stringify(welcomeGrant()) === JSON.stringify({ credits: 10, remaining: 5.5, status: "active" }),
    { tooBigForFree, paidHold, afterPaid, grant: welcomeGrant() },
  );

  const moved = await run(
    credits.transfer(OWNER.id, { serverId: SERVER_ID, direction: "to_server", credits: 2_000 - 8.5 - 20 }),
  );
  const tooFar = await failure(credits.transfer(OWNER.id, { serverId: SERVER_ID, direction: "to_server", credits: 1 }));
  check(
    "a move to a server takes all paid credits but never the free credits",
    moved.balance === 5.5 && tooFar.code === "credits_not_enough" && (await state(OWNER.id)).welcome === 5.5,
    { moved, tooFar },
  );
  await run(credits.transfer(OWNER.id, { serverId: SERVER_ID, direction: "to_personal", credits: 1_000 }));

  const refund = {
    id: "re_w1",
    object: "refund",
    status: "succeeded",
    payment_intent: "pi_w1",
    amount: 10_000,
    currency: "eur",
  };
  await deliver("refund.created", refund);
  const refunded = await state(OWNER.id);
  check(
    "a refund takes back paid credits only and keeps the free credits",
    refunded.balance === 5.5 && refunded.welcome === 5.5,
    refunded,
  );
}

async function creditCodes() {
  const { database, stripe, credits, state, creditEvents } = await harness();
  const now = Date.now();
  const made: string[] = [];
  const addresses: string[] = [];
  const addCode = async (
    id: string,
    credits: number,
    options: { max?: number; expiresAt?: number; disabled?: boolean; campaign?: string } = {},
  ) => {
    const code = generateCreditCode();
    made.push(code);
    database
      .prepare(
        `INSERT INTO credit_codes(code_id, code_hash, credits_tenths, max_redemptions, grant_days, expires_at, campaign, created_at, disabled_at)
         VALUES (?, ?, ?, ?, 30, ?, ?, ?, ?)`,
      )
      .run(
        id,
        await creditCodeHash(code),
        credits * 10,
        options.max ?? 1,
        options.expiresAt ?? null,
        options.campaign ?? "",
        now - 1,
        options.disabled ? now - 1 : null,
      );
    return code;
  };
  const addUsers = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => {
      const id = `${prefix}-${index}`;
      database
        .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, ?, ?, 1, 1)")
        .run(id, `email:${id}@example.test`, `${id}@example.test`);
      return id;
    });
  const network = (last: number) => {
    const address = `198.51.100.${last}`;
    addresses.push(address);
    return address;
  };
  const home = network(7);
  const redeem = (userId: string, code: string, options: { serverId?: string; from?: string } = {}) =>
    credits.redeem(
      userId,
      options.serverId === undefined ? { code } : { code, serverId: options.serverId },
      options.from ?? home,
    );
  const nextHour = () =>
    database.prepare("UPDATE credit_code_limits SET window_start = window_start - ?").run(CREDIT_CODE_LIMIT_WINDOW_MS);
  const clearLimits = () => database.prepare("DELETE FROM credit_code_limits").run();
  const limitedBy = async (limit: CreditCodeLimit) => {
    await creditEvents();
    return stripe.tracked.filter(
      (event) =>
        event.name === "credit_code_redeem" &&
        event.properties.get("outcome") === "rate_limited" &&
        event.properties.get("limit") === limit,
    ).length;
  };

  const generated = Array.from({ length: 2_000 }, generateCreditCode);
  check(
    "generated codes have 16 characters from the 32-character alphabet and do not repeat",
    new Set(generated).size === generated.length &&
      generated.every((code) => /^[2-9A-HJ-NP-Z]{16}$/.test(code)) &&
      new Set(generated.join("")).size === 32,
  );

  const single = await addCode("code-single", 500, { campaign: "launch-week" });
  const typed = formatCreditCode(single).toLowerCase().replaceAll("-", " - ");
  const won = await Effect.runPromise(redeem(OWNER.id, typed));
  check(
    "a code typed in lower case with spaces and dashes gives its credits to the personal wallet",
    won.credits === 500 && won.state.balance === 500,
    won,
  );
  const grant = database
    .prepare(
      "SELECT user_id, server_id, credits_tenths, source, expires_at - starts_at AS days FROM credit_grants WHERE source = 'code:code-single'",
    )
    .get();
  check(
    "the redemption is a free grant that ends after the grant days of the code",
    grant?.user_id === OWNER.id &&
      grant.server_id === null &&
      grant.credits_tenths === 5_000 &&
      grant.days === 30 * DAY_MS,
    grant,
  );
  check(
    "the same account cannot redeem a code two times",
    (await failure(redeem(OWNER.id, single))).code === "credit_code_redeemed",
  );
  check(
    "another account cannot redeem a code that has no redemptions left",
    (await failure(redeem(MEMBER.id, single))).code === "credit_code_used",
  );
  const second = await addCode("code-second", 25);
  const secondWon = await Effect.runPromise(redeem(OWNER.id, second));
  check(
    "one account can redeem different codes",
    secondWon.credits === 25 && secondWon.state.balance === 525,
    secondWon,
  );

  const shared = await addCode("code-shared", 50, { max: 2, campaign: "partners" });
  const serverWon = await Effect.runPromise(redeem(MEMBER.id, shared, { serverId: SERVER_ID }));
  check(
    "a member can redeem a code for the server wallet",
    serverWon.credits === 50 && serverWon.state.servers.find((item) => item.serverId === SERVER_ID)?.balance === 50,
    serverWon,
  );
  check(
    "an account cannot redeem a code for a server that it is not a member of",
    (await failure(redeem(OUTSIDER.id, shared, { serverId: SERVER_ID }))).code === "credits_server_member",
  );
  const racers = await Promise.allSettled([
    Effect.runPromise(redeem(OWNER.id, shared)),
    Effect.runPromise(redeem(OUTSIDER.id, shared)),
  ]);
  const sharedRow = database.prepare("SELECT redemptions FROM credit_codes WHERE code_id = 'code-shared'").get();
  check(
    "two accounts that redeem the last use at the same time get it only one time",
    racers.filter((item) => item.status === "fulfilled").length === 1 && sharedRow?.redemptions === 2,
    { racers: racers.map((item) => item.status), sharedRow },
  );

  const expired = await addCode("code-expired", 10, { expiresAt: now - 1 });
  const disabled = await addCode("code-disabled", 10, { disabled: true });
  check(
    "an expired code and a disabled code give nothing",
    (await failure(redeem(MEMBER.id, expired))).code === "credit_code_expired" &&
      (await failure(redeem(MEMBER.id, disabled))).code === "credit_code_invalid",
  );
  check(
    "a code with a wrong letter is not valid",
    (await failure(redeem(MEMBER.id, `${single.slice(0, -1)}${single.endsWith("2") ? "3" : "2"}`))).code ===
      "credit_code_invalid",
  );
  check(
    "the request parser refuses a code that is not text, a long code and a wrong server ID",
    parseCreditRedeemRequest({ code: 1 }) === null &&
      parseCreditRedeemRequest({ code: "A".repeat(65) }) === null &&
      parseCreditRedeemRequest({ code: single, serverId: "" }) === null &&
      parseCreditRedeemRequest({ code: single })?.code === single,
  );

  clearLimits();
  const guesser = OUTSIDER.id;
  const guesserNetwork = network(10);
  for (let attempt = 0; attempt < CREDIT_CODE_LIMITS.account_wrong; attempt += 1) {
    await failure(redeem(guesser, generateCreditCode(), { from: guesserNetwork }));
  }
  const fresh = await addCode("code-fresh", 20);
  check(
    `after ${CREDIT_CODE_LIMITS.account_wrong} wrong codes in one hour, a correct code also waits, from any network`,
    (await failure(redeem(guesser, fresh, { from: guesserNetwork }))).code === "credit_code_attempts" &&
      (await failure(redeem(guesser, fresh, { from: network(11) }))).code === "credit_code_attempts" &&
      (await limitedBy("account_wrong")) === 2,
  );
  nextHour();
  const afterWait = await Effect.runPromise(redeem(guesser, fresh, { from: guesserNetwork }));
  check("after one hour the account can redeem again", afterWait.credits === 20, afterWait);

  clearLimits();
  const usedTries: string[] = [];
  for (let attempt = 0; attempt <= CREDIT_CODE_LIMITS.account_wrong; attempt += 1) {
    usedTries.push((await failure(redeem(MEMBER.id, single))).code);
  }
  const stillOpen = await addCode("code-still-open", 2);
  const afterUsed = await Effect.runPromise(redeem(MEMBER.id, stillOpen));
  check(
    "a code that is used, expired or redeemed before is not a wrong code: the account can still redeem",
    usedTries.every((code) => code === "credit_code_used") && afterUsed.credits === 2,
    { usedTries, afterUsed: afterUsed.credits },
  );

  clearLimits();
  const crowd = addUsers("crowd", CREDIT_CODE_LIMITS.network_wrong / 5);
  const crowdNetwork = network(20);
  for (const user of crowd) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await failure(redeem(user, generateCreditCode(), { from: crowdNetwork }));
    }
  }
  const neighbour = await addCode("code-neighbour", 5);
  check(
    `after ${CREDIT_CODE_LIMITS.network_wrong} wrong codes from one network, other accounts on that network wait`,
    (await failure(redeem(MEMBER.id, neighbour, { from: crowdNetwork }))).code === "credit_code_attempts" &&
      (await limitedBy("network_wrong")) === 1,
  );
  const elsewhere = await Effect.runPromise(redeem(MEMBER.id, neighbour, { from: network(21) }));
  check("an account on another network is not stopped by that network", elsewhere.credits === 5, elsewhere);

  clearLimits();
  const open = await addCode("code-open", 1, { max: 1_000 });
  const busy = OUTSIDER.id;
  const busyNetwork = network(30);
  for (let attempt = 0; attempt < CREDIT_CODE_LIMITS.account_tries; attempt += 1) {
    await failure(redeem(busy, open, { serverId: SERVER_ID, from: busyNetwork }));
  }
  check(
    `after ${CREDIT_CODE_LIMITS.account_tries} tries in one hour, an account waits even when no code was wrong`,
    (await failure(redeem(busy, open, { from: network(31) }))).code === "credit_code_attempts" &&
      (await limitedBy("account_tries")) === 1,
  );
  for (let attempt = 0; attempt < CREDIT_CODE_LIMITS.network_tries; attempt += 1) {
    await failure(redeem(busy, open, { from: busyNetwork }));
  }
  const [busyNeighbour] = addUsers("busy-neighbour", 1);
  const busyNeighbourWon = await Effect.runPromise(redeem(busyNeighbour ?? "", open, { from: busyNetwork }));
  check(
    "tries that an account limit refuses do not count against the network",
    busyNeighbourWon.credits === 1,
    busyNeighbourWon,
  );

  clearLimits();
  const flood = addUsers("flood", CREDIT_CODE_LIMITS.network_tries / CREDIT_CODE_LIMITS.account_tries + 1);
  const floodNetwork = network(40);
  const floodLast = flood.at(-1) ?? "";
  for (const user of flood.slice(0, -1)) {
    for (let attempt = 0; attempt < CREDIT_CODE_LIMITS.account_tries; attempt += 1) {
      await failure(redeem(user, open, { serverId: SERVER_ID, from: floodNetwork }));
    }
  }
  check(
    `after ${CREDIT_CODE_LIMITS.network_tries} tries from one network, a new account on it waits`,
    (await failure(redeem(floodLast, open, { from: floodNetwork }))).code === "credit_code_attempts" &&
      (await limitedBy("network_tries")) === 1,
  );
  const floodElsewhere = await Effect.runPromise(redeem(floodLast, open, { from: network(41) }));
  check("the same account can redeem from another network", floodElsewhere.credits === 1, floodElsewhere);

  clearLimits();
  const promo = await addCode("code-promo", 3, { max: 1_000, campaign: "spring-promo" });
  const farm = addUsers("farm", CREDIT_CODE_LIMITS.network_code + 1);
  const farmNetwork = network(50);
  const farmed: boolean[] = [];
  for (const user of farm) {
    farmed.push(
      await Effect.runPromise(redeem(user, promo, { from: farmNetwork })).then(
        () => true,
        () => false,
      ),
    );
  }
  const promoRow = database.prepare("SELECT redemptions FROM credit_codes WHERE code_id = 'code-promo'").get();
  check(
    `one network redeems one shared code for at most ${CREDIT_CODE_LIMITS.network_code} accounts in one hour`,
    farmed.filter(Boolean).length === CREDIT_CODE_LIMITS.network_code &&
      promoRow?.redemptions === CREDIT_CODE_LIMITS.network_code &&
      (await limitedBy("network_code")) === 1,
    { promoRow },
  );
  const farmLast = farm.at(-1) ?? "";
  const farmElsewhere = await Effect.runPromise(redeem(farmLast, promo, { from: network(51) }));
  check("the stopped account can redeem the shared code from another network", farmElsewhere.credits === 3);

  const activity = await Effect.runPromise(credits.activity(OWNER.id));
  check(
    "the activity shows the redeemed credits as free credits from the account",
    activity.entries.some((item) => item.kind === "free" && item.credits === 500 && item.actor === "you"),
    activity.entries.filter((item) => item.kind === "free"),
  );
  const ownerState = await state(OWNER.id);
  const ownerWonRace = racers[0].status === "fulfilled";
  check("the redeemed credits are in the balance", ownerState.balance === (ownerWonRace ? 575 : 525), {
    ownerWonRace,
    balance: ownerState.balance,
  });

  const limits = database.prepare("SELECT * FROM credit_code_limits").all();
  const limitText = JSON.stringify(limits);
  check(
    "the limit table keeps only hashed keys: no account ID, network address or code",
    limits.length > 0 &&
      limits.every((row) => typeof row.key_hash === "string" && /^[0-9a-f]{64}$/.test(row.key_hash)) &&
      [...addresses, OWNER.id, MEMBER.id, OUTSIDER.id, ...flood, ...farm].every((value) => !limitText.includes(value)),
    limits.slice(0, 3),
  );
  const stored = JSON.stringify([
    database.prepare("SELECT * FROM credit_codes").all(),
    database.prepare("SELECT * FROM credit_code_redemptions").all(),
    database.prepare("SELECT * FROM credit_grants").all(),
    database.prepare("SELECT * FROM credit_ledger").all(),
    limits,
    auditRows(database),
  ]);
  const plainCodes = made.flatMap((code) => [code, formatCreditCode(code)]);
  check(
    "the database, the ledger and the audit keep no plain code and no network address",
    [...plainCodes, ...addresses].every((value) => !stored.includes(value)),
  );
  const trail = auditRows(database);
  check(
    "the audit records each refused redemption with its code",
    [
      "credit_code_redeemed",
      "credit_code_used",
      "credit_code_expired",
      "credit_code_invalid",
      "credit_code_attempts",
      "credits_server_member",
    ].every((code) => audited(trail, { event: "redeem", result: "failed", code }).length > 0),
    trail.filter((row) => row.event === "redeem"),
  );
  const events = await creditEvents();
  check(
    "analytics count each redemption with its wallet, credits, campaign and use count, and no code",
    eventsOf(events, OWNER.id, {
      action: "redeemed",
      wallet: "personal",
      credits: 500,
      campaign: "launch-week",
      code_uses: "single",
    }).length === 1 &&
      eventsOf(events, OWNER.id, { action: "redeemed", wallet: "personal", credits: 25, code_uses: "single" }).filter(
        (event) => !event.properties.has("campaign"),
      ).length === 1 &&
      eventsOf(events, MEMBER.id, {
        action: "redeemed",
        wallet: "server",
        credits: 50,
        campaign: "partners",
        code_uses: "multi",
      }).length === 1 &&
      keepsPrivate(events, [...plainCodes, ...addresses, SERVER_ID]),
    readable(events.filter((event) => event.properties.get("action") === "redeemed")),
  );
  const tries = stripe.tracked.filter((event) => event.name === "credit_code_redeem");
  const outcomes = new Set(tries.map((event) => event.properties.get("outcome")));
  check(
    "analytics send one try event for each redemption try, with its outcome and no code, address or server",
    ["redeemed", "invalid", "disabled", "expired", "used_up", "redeemed_before", "not_member", "rate_limited"].every(
      (outcome) => outcomes.has(outcome),
    ) &&
      eventsOf(tries, OUTSIDER.id, { outcome: "not_member", wallet: "server", campaign: "partners" }).length === 1 &&
      eventsOf(tries, OWNER.id, { outcome: "redeemed_before", campaign: "launch-week", code_uses: "single" }).length ===
        1 &&
      tries.every(
        (event) =>
          (event.properties.get("outcome") === "rate_limited") === event.properties.has("limit") &&
          (event.properties.get("outcome") === "redeemed") === event.properties.has("credits"),
      ) &&
      keepsPrivate(tries, [...plainCodes, ...addresses, SERVER_ID]),
    readable(tries.slice(0, 12)),
  );
}

let passed = false;
try {
  await walletsAndTransfers();
  await holdsAndSpending();
  await holdLimits();
  await freeMonthlyCredits();
  await welcomeCredits();
  await creditCodes();
  passed = checks.every((item) => item.passed);
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) console.log(`${item.passed ? "ok  " : "FAIL"} ${item.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!passed) process.exit(1);
