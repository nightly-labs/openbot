/**
 * End-to-end check of the hosted server plan flows against the Stripe sandbox and a local account Worker.
 * Each scenario gets its own account and a Stripe test clock, so renewals and period ends happen at once.
 * A subscription made here with the server metadata stands for a paid Checkout page: the Worker reads
 * only the subscription webhooks. Local development data only. On the `test` Worker each paid server is
 * a real boat VM, so the check deletes the servers of each scenario when it ends.
 *
 *   bunx dotenvx run -q -f apps/auth-api/.env.shared -fk .env.keys -- \
 *     bun scripts/stripe-flows-e2e.ts --api http://127.0.0.1:<port> [scenario ...]
 *
 * The Worker must run with `HOSTED_SERVERS_ALLOWED_USER_IDS` set to the IDs that `--print-user-ids`
 * prints, and `stripe listen` must forward to it. The `portal` scenario prints two Customer Portal
 * pages and waits until someone uses them. The report goes to `.openbot-build/stripe-flows-e2e.json`.
 *
 * The `boat` scenario runs only when named. It makes a real VM: the Worker needs the real `BOAT_API_KEY`
 * and `HOSTED_SERVER_TEMPLATE`, and the template must know a public origin of this Worker. It waits
 * until OpenBot in the VM redeems its claim and publishes its host. Then it waits for the idle stop
 * (about 15 minutes), starts the server, changes the plan, ends it, renews it, and deletes the server.
 * `--checkout` pays each Checkout page with a test card in the local Chrome. The web client then
 * connects to the server over Signal, and the screenshots go to `.openbot-build/`.
 * `--remote-d1` reads the D1 of the deployed `test` Worker; pass its origin as `--api`.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { BillingPortalRequest } from "@openbot/contracts/billing";
import { type Browser, chromium } from "playwright-core";
import { z } from "zod";
import { STRIPE_API_VERSION } from "../apps/auth-api/src/server/stripe-client";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = join(ROOT, ".openbot-build", "stripe-flows-e2e.json");
const SCENARIOS = [
  "renewal",
  "failed-renewal",
  "cancel-at-period-end",
  "plan-change",
  "renew",
  "delete",
  "foreign",
  "customer-deleted",
  "portal",
  "boat",
] as const;
type Scenario = (typeof SCENARIOS)[number];
const DAY = 86_400;

const stepSchema = z.object({
  scenario: z.enum(SCENARIOS),
  step: z.string(),
  result: z.enum(["pass", "fail"]),
  evidence: z.unknown(),
});
type Step = z.infer<typeof stepSchema>;
const steps: Step[] = [];

const idSchema = z.object({ id: z.string() });
const clockSchema = z.object({ id: z.string(), status: z.string(), frozen_time: z.number() });
const subscriptionSchema = z.object({
  id: z.string(),
  status: z.string(),
  latest_invoice: z.string().nullable(),
  cancel_at_period_end: z.boolean(),
  cancel_at: z.number().nullable(),
  items: z.object({ data: z.array(z.object({ id: z.string() })) }),
});
const invoiceListSchema = z.object({
  data: z.array(z.object({ billing_reason: z.string().nullable(), status: z.string(), amount_paid: z.number() })),
});
const checkoutSessionSchema = z.object({ status: z.string().nullable(), customer: z.string().nullable() });
const scheduleSchema = z.object({
  id: z.string(),
  phases: z.array(z.object({ start_date: z.number(), end_date: z.number() })),
});

const rowSchema = z.object({
  server_id: z.string(),
  size: z.string(),
  plan: z.string().nullable(),
  billing_interval: z.string().nullable(),
  currency: z.string().nullable(),
  desired_state: z.string(),
  observed_state: z.string(),
  observed_error: z.string().nullable(),
  provider_sandbox_id: z.string().nullable(),
  checkout_session_id: z.string().nullable(),
  last_active_at: z.number().nullable(),
  deleted_at: z.number().nullable(),
});
type Row = z.infer<typeof rowSchema>;

const createdSchema = z.object({ server: z.object({ serverId: z.string() }), checkoutUrl: z.string().nullable() });
const checkoutSchema = z.object({ checkoutUrl: z.string().nullable() });
const serverListSchema = z.object({
  servers: z.array(z.object({ serverId: z.string(), name: z.string(), state: z.string() })),
});
const sandboxIdSchema = z.object({ provider_sandbox_id: z.string() });
const planSchema = z.object({
  subscriptionId: z.string(),
  plan: z.string(),
  status: z.string(),
  currentPeriodEnd: z.number().nullable(),
  cancelAtPeriodEnd: z.boolean(),
});
type Plan = z.infer<typeof planSchema>;
const billingSchema = z.object({ servers: z.array(planSchema) });
const errorSchema = z.object({ error: z.object({ code: z.string() }) });
const hostSchema = z.object({
  claim_redeemed_at: z.number().nullable(),
  host_name: z.string().nullable(),
  published: z.number(),
});
const commandSchema = z.object({ exitCode: z.number().nullable().optional(), stdout: z.string().optional() });
const sandboxSchema = z.object({ sandbox: z.object({ state: z.string(), type: z.string().optional() }) });
const portalSchema = z.object({ url: z.string() });

/** The request bodies of the browser API routes that this check calls. */
type BrowserApiBody =
  | { name: string; plan: "starter"; interval: "month"; currency: "eur" }
  | { confirmName: string }
  | BillingPortalRequest
  | Record<string, never>;

function print(line: string) {
  process.stdout.write(`${line}\n`);
}

function userId(scenario: Scenario): string {
  return `stripe-e2e-${scenario}`;
}

async function stripe<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  schema: z.ZodType<T>,
  params: Record<string, string> = {},
): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!/^(sk|rk)_test_/u.test(key)) throw new Error("STRIPE_SECRET_KEY must be a test-mode key.");
  const body = new URLSearchParams(params).toString();
  const url = `https://api.stripe.com${path}${method === "GET" && body ? `?${body}` : ""}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": STRIPE_API_VERSION,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(method === "POST" ? { body } : {}),
  });
  const value = z.unknown().parse(await response.json());
  if (!response.ok) {
    const error = z.object({ error: z.object({ message: z.string().optional() }) }).safeParse(value);
    throw new Error(`Stripe ${method} ${path} ${response.status}: ${error.data?.error.message ?? "unknown error"}`);
  }
  return schema.parse(value);
}

/** The `boat` scenario only. The development key from `.env.shared` reads the VM of the test server. */
async function boat(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: { command: string; timeoutSeconds: number },
) {
  const key = process.env.BOAT_API_KEY ?? "";
  if (!key.startsWith("boat_")) throw new Error("BOAT_API_KEY must be the development boat key.");
  const response = await fetch(`https://boat.dev/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      // boat deletes a sandbox only when this header names it.
      ...(method === "DELETE" ? { "X-Ascii-Confirm-Delete": path.split("/").at(-1) ?? "" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: z.unknown().parse(await response.json().catch(() => null)) };
}

const d1ResultSchema = z.array(z.object({ results: z.array(z.unknown()) }));

/** `--remote-d1` reads the D1 of the deployed `test` Worker. Wrangler then uses its own sign-in, not the API token. */
const REMOTE_D1 = process.argv.includes("--remote-d1");
/** `--checkout` pays the boat server on the real Checkout page with a test card, in the local Chrome. */
const REAL_CHECKOUT = process.argv.includes("--checkout");

function d1<T>(sql: string, schema: z.ZodType<T>): T[] {
  const target = REMOTE_D1 ? ["openbot-auth-test", "--remote", "--env", "test"] : ["openbot-auth", "--local"];
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (REMOTE_D1) delete env.CLOUDFLARE_API_TOKEN;
  const result = spawnSync(
    join(ROOT, "node_modules/.bin/wrangler"),
    ["d1", "execute", ...target, "--json", "--command", sql],
    { cwd: join(ROOT, "apps/auth-api"), encoding: "utf8", env },
  );
  if (result.status !== 0) throw new Error(`D1 failed: ${result.stderr.slice(0, 400)}`);
  return d1ResultSchema
    .parse(JSON.parse(result.stdout))
    .flatMap((entry) => entry.results)
    .map((row) => schema.parse(row));
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

class Account {
  readonly token = randomBytes(24).toString("base64url");
  clock = "";
  customer = "";

  constructor(
    readonly scenario: Scenario,
    readonly api: string,
  ) {}

  get id() {
    return userId(this.scenario);
  }

  /** A fresh account with a session, a test clock and a customer that pays with a working card. */
  async setUp(): Promise<this> {
    const now = Date.now();
    const hash = createHash("sha256").update(this.token).digest("base64url");
    const id = quote(this.id);
    // A run that stopped early can leave a VM. Delete it before its row, so that no VM stays without a row.
    const left = d1(
      `SELECT provider_sandbox_id FROM hosted_servers
       WHERE owner_user_id = ${id} AND provider_sandbox_id IS NOT NULL AND deleted_at IS NULL`,
      sandboxIdSchema,
    );
    for (const row of left) await boat("DELETE", `/sandboxes/${row.provider_sandbox_id}`);
    d1(
      [
        `DELETE FROM hosted_servers WHERE owner_user_id = ${id}`,
        `DELETE FROM billing_subscriptions WHERE user_id = ${id}`,
        `DELETE FROM billing_customers WHERE user_id = ${id}`,
        `DELETE FROM auth_sessions WHERE user_id = ${id}`,
        `INSERT OR IGNORE INTO users(id, identity_key, email, name, created_at, updated_at)
         VALUES (${id}, ${quote(`e2e:${this.id}`)}, ${quote(`${this.id}@example.com`)}, 'Stripe e2e', ${now}, ${now})`,
        `INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
         VALUES (${quote(crypto.randomUUID())}, ${id}, ${quote(hash)}, ${now + DAY * 1_000}, ${now}, ${now})`,
      ].join("; "),
      z.unknown(),
    );
    const clock = await stripe("POST", "/v1/test_helpers/test_clocks", idSchema, {
      frozen_time: String(Math.floor(now / 1_000)),
      name: `openbot ${this.scenario}`,
    });
    this.clock = clock.id;
    const customer = await stripe("POST", "/v1/customers", idSchema, {
      email: `${this.id}@example.com`,
      test_clock: this.clock,
      payment_method: "pm_card_visa",
      "invoice_settings[default_payment_method]": "pm_card_visa",
      "metadata[openbot_user_id]": this.id,
    });
    this.customer = customer.id;
    // The Worker makes a customer without a test clock, so the account gets this one before its first Checkout.
    d1(
      `INSERT INTO billing_customers(user_id, stripe_customer_id, created_at, updated_at)
       VALUES (${id}, ${quote(this.customer)}, ${now}, ${now})`,
      z.unknown(),
    );
    return this;
  }

  async request(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: BrowserApiBody,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(`${this.api}/api/browser/${path}`, {
      method,
      headers: {
        Cookie: `__Host-openbot-web=${this.token}`,
        ...(method === "GET" ? {} : { Origin: this.api, "X-OpenBot-Browser": "1", "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = z.unknown().parse(await response.json().catch(() => null));
    return { status: response.status, body: value, code: errorSchema.safeParse(value).data?.error.code ?? null };
  }

  async createServer(name: string) {
    const response = await this.request(
      "POST",
      "v2/hosting/servers",
      { name, plan: "starter", interval: "month", currency: "eur" },
      { "Idempotency-Key": `e2e-${this.scenario}-${randomBytes(8).toString("hex")}` },
    );
    if (response.status !== 201) throw new Error(`create ${response.status}: ${response.code}`);
    return createdSchema.parse(response.body);
  }

  /**
   * Deletes the servers of this account through the Worker. On the `test` Worker a paid server is a real
   * VM, so no VM or plan stays after the scenario.
   */
  async tearDown() {
    const listed = serverListSchema.safeParse((await this.request("GET", "v2/hosting/servers")).body).data;
    for (const server of listed?.servers ?? []) {
      if (server.state === "deleted") continue;
      await this.request("DELETE", `v2/hosting/servers/${server.serverId}`, { confirmName: server.name });
    }
  }

  async checkout(serverId: string) {
    const response = await this.request("POST", `v2/hosting/servers/${serverId}/checkout`, {});
    return { status: response.status, code: response.code, ...checkoutSchema.safeParse(response.body).data };
  }

  async portal(flow: "cancel" | "update", subscriptionId: string) {
    const response = await this.request("POST", "v1/me/billing/portal", { flow, subscriptionId });
    return { status: response.status, url: portalSchema.safeParse(response.body).data?.url ?? null };
  }

  async billing() {
    return billingSchema.parse((await this.request("GET", "v1/me/billing")).body).servers;
  }

  async plan(subscriptionId: string): Promise<Plan | null> {
    return (await this.billing()).find((entry) => entry.subscriptionId === subscriptionId) ?? null;
  }

  row(serverId: string): Row | null {
    return (
      d1(
        `SELECT server_id, size, plan, billing_interval, currency, desired_state, observed_state, observed_error,
                provider_sandbox_id, checkout_session_id, last_active_at, deleted_at
         FROM hosted_servers WHERE server_id = ${quote(serverId)}`,
        rowSchema,
      )[0] ?? null
    );
  }

  /**
   * Pays for the server as a completed Checkout does: the open page closes, and a subscription with the
   * server metadata starts.
   */
  async pay(serverId: string) {
    const session = this.row(serverId)?.checkout_session_id;
    if (session) await stripe("POST", `/v1/checkout/sessions/${session}/expire`, idSchema).catch(() => null);
    const subscription = await stripe("POST", "/v1/subscriptions", idSchema, {
      customer: this.customer,
      "items[0][price]": await priceId("starter", "month"),
      currency: "eur",
      "metadata[openbot_user_id]": this.id,
      "metadata[openbot_server_id]": serverId,
      payment_behavior: "error_if_incomplete",
    });
    return subscription.id;
  }

  async useCard(card: string) {
    const attached = await stripe("POST", `/v1/payment_methods/${card}/attach`, idSchema, { customer: this.customer });
    await stripe("POST", `/v1/customers/${this.customer}`, idSchema, {
      "invoice_settings[default_payment_method]": attached.id,
    });
    return attached.id;
  }

  /** Moves the test clock and waits until Stripe has run everything that the move made due. */
  async advance(days: number) {
    const clock = await stripe("GET", `/v1/test_helpers/test_clocks/${this.clock}`, clockSchema);
    const target = clock.frozen_time + days * DAY;
    await stripe("POST", `/v1/test_helpers/test_clocks/${this.clock}/advance`, clockSchema, {
      frozen_time: String(target),
    });
    await waitFor(
      `clock ${this.scenario} +${days}d`,
      async () => {
        const current = await stripe("GET", `/v1/test_helpers/test_clocks/${this.clock}`, clockSchema);
        return current.status === "ready";
      },
      180_000,
    );
    return target;
  }
}

/** The `boat` scenario only: the local Chrome, headless, for the Checkout page and the web client. */
let chrome: Promise<Browser> | null = null;
const browser = () => {
  chrome ??= chromium.launch({ channel: "chrome", headless: true });
  return chrome;
};

/** Pays a Checkout page with the Stripe test card and waits for the return to the Worker. */
async function payCheckout(url: string, returnOrigin: string, screenshot: string) {
  const context = await (await browser()).newContext();
  try {
    const page = await context.newPage();
    await page.goto(url);
    try {
      // With more than one payment method, Checkout shows the card fields after the card choice.
      const card = page.getByRole("radio", { name: "Card", exact: true });
      await Promise.race([card.waitFor(), page.locator("#cardNumber").waitFor()]);
      if (await card.isVisible()) await card.check({ force: true });
      await page.fill("#cardNumber", "4242424242424242");
    } catch (error) {
      await page.screenshot({ path: join(ROOT, ".openbot-build", `failed-${screenshot}`), fullPage: true });
      throw error;
    }
    await page.fill("#cardExpiry", "12 / 34");
    await page.fill("#cardCvc", "123");
    await page.fill("#billingName", "Stripe E2E");
    const country = page.locator("#billingCountry");
    if (await country.count()) await country.selectOption("PL");
    const zip = page.locator("#billingPostalCode");
    if ((await zip.count()) && (await zip.isVisible())) await zip.fill("00-001");
    const save = page.locator("#enableStripePass");
    if ((await save.count()) && (await save.isChecked())) await save.dispatchEvent("click");
    await page.screenshot({ path: join(ROOT, ".openbot-build", screenshot) });
    await page.getByTestId("hosted-payment-submit-button").dispatchEvent("click");
    await page.waitForURL((current) => current.origin === returnOrigin, { timeout: 90_000 });
    return new URL(page.url()).pathname;
  } finally {
    await context.close();
  }
}

// Keeps each peer connection of the page, so the check can read the selected ICE candidates.
const PEER_TRACE = `(() => {
  const Native = window.RTCPeerConnection;
  window.__e2ePeers = [];
  window.RTCPeerConnection = function (...args) {
    const peer = new Native(...args);
    window.__e2ePeers.push(peer);
    return peer;
  };
  window.RTCPeerConnection.prototype = Native.prototype;
})();`;
const PEER_STATS = `(async () => {
  const peers = [];
  for (const peer of window.__e2ePeers ?? []) {
    const stats = await peer.getStats();
    let pair = null;
    stats.forEach((entry) => {
      if (entry.type === "transport" && entry.selectedCandidatePairId) pair = stats.get(entry.selectedCandidatePairId);
    });
    peers.push({
      state: peer.connectionState,
      local: pair ? (stats.get(pair.localCandidateId)?.candidateType ?? null) : null,
      remote: pair ? (stats.get(pair.remoteCandidateId)?.candidateType ?? null) : null,
      iceServers: (peer.getConfiguration().iceServers ?? []).flatMap((server) =>
        [].concat(server.urls).map((url) => url.split("?")[0])),
    });
  }
  return peers;
})()`;
const peersSchema = z.array(
  z.object({
    state: z.string(),
    local: z.string().nullable(),
    remote: z.string().nullable(),
    iceServers: z.array(z.string()),
  }),
);

/**
 * Opens the web client as the account, waits until it shows the server and a peer connection is
 * connected, and then waits for the server's next activity report. Closing the page ends the use.
 */
async function connectWeb(account: Account, serverId: string, name: string, screenshot: string) {
  const context = await (await browser()).newContext();
  try {
    await context.addCookies([
      { name: "__Host-openbot-web", value: account.token, url: `${account.api}/`, secure: true, httpOnly: true },
    ]);
    await context.addInitScript(PEER_TRACE);
    const page = await context.newPage();
    const consoleLines: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") consoleLines.push(message.text());
    });
    const start = Date.now();
    await page.goto(`${account.api}/app`);
    const fail = async (error: unknown) => {
      await page.screenshot({ path: join(ROOT, ".openbot-build", `failed-${screenshot}`), fullPage: true });
      const snapshot = await page.locator("body").ariaSnapshot();
      process.stdout.write(`page: ${page.url()}\n${snapshot}\nconsole:\n${consoleLines.join("\n")}\n`);
      throw error;
    };
    // The rail names the button "{name} server", followed by its status labels.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const label = new RegExp(`^${escaped} server(,|$)`, "u");
    await page.getByRole("button", { name: label }).waitFor({ timeout: 180_000 }).catch(fail);
    const peers = await waitFor(
      "peer connected",
      async () => {
        const list = peersSchema.parse(await page.evaluate(PEER_STATS));
        return list.some((peer) => peer.state === "connected") ? list : null;
      },
      120_000,
    ).catch(fail);
    const connectedAt = Date.now();
    await page.screenshot({ path: join(ROOT, ".openbot-build", screenshot) });
    const reported = await waitFor(
      "activity report",
      async () => {
        const row = account.row(serverId);
        return row?.last_active_at && row.last_active_at >= connectedAt ? row.last_active_at : null;
      },
      180_000,
    ).catch(() => null);
    return { connectMs: connectedAt - start, peers, activityReportedAfterMs: reported ? reported - connectedAt : null };
  } finally {
    await context.close();
  }
}

const priceIds = new Map<string, string>();
async function priceId(plan: string, interval: string): Promise<string> {
  const key = `openbot_${plan}_${interval}`;
  const cached = priceIds.get(key);
  if (cached) return cached;
  const list = await stripe("GET", "/v1/prices", z.object({ data: z.array(idSchema) }), {
    "lookup_keys[]": key,
    active: "true",
  });
  const id = list.data[0]?.id;
  if (!id) throw new Error(`No price ${key}`);
  priceIds.set(key, id);
  return id;
}

const subscription = (id: string) => stripe("GET", `/v1/subscriptions/${id}`, subscriptionSchema);

async function invoices(subscriptionId: string) {
  const list = await stripe("GET", "/v1/invoices", invoiceListSchema, { subscription: subscriptionId, limit: "3" });
  return list.data.map((invoice) => ({
    reason: invoice.billing_reason,
    status: invoice.status,
    amount: invoice.amount_paid,
  }));
}

async function waitFor<T>(label: string, check: () => Promise<T | null | undefined | false>, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
      last = String(value);
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(1_500);
  }
  throw new Error(`Timed out: ${label} (last: ${last})`);
}

function record(scenario: Scenario, step: string, pass: boolean, evidence: unknown) {
  steps.push({ scenario, step, result: pass ? "pass" : "fail", evidence });
  print(`${pass ? "PASS" : "FAIL"} [${scenario}] ${step}`);
}

/** The row once the Worker applied the paid plan. With a fake boat key the provision ends in a provider error. */
function provisioned(account: Account, serverId: string) {
  return waitFor("provisioned", async () => {
    const row = account.row(serverId);
    return row && row.observed_state !== "awaiting_payment" && row.observed_state !== "creating" ? row : null;
  });
}

function rowWhere(account: Account, serverId: string, label: string, test: (row: Row) => boolean, timeoutMs?: number) {
  return waitFor(
    label,
    async () => {
      const row = account.row(serverId);
      return row && test(row) ? row : null;
    },
    timeoutMs,
  );
}

function planWhere(account: Account, subscriptionId: string, label: string, test: (plan: Plan) => boolean) {
  return waitFor(label, async () => {
    const plan = await account.plan(subscriptionId);
    return plan && test(plan) ? plan : null;
  });
}

const scenarios: Record<Scenario, (account: Account) => Promise<void>> = {
  async renewal(account) {
    const { server } = await account.createServer("Renewal");
    const sub = await account.pay(server.serverId);
    const row = await provisioned(account, server.serverId);
    const before = await planWhere(account, sub, "plan", () => true);
    record("renewal", "payment opens the plan and provisions the server", row.desired_state === "running", {
      row,
      before,
    });
    await account.advance(32);
    const after = await planWhere(
      account,
      sub,
      "renewed period",
      (plan) => (plan.currentPeriodEnd ?? 0) > (before.currentPeriodEnd ?? 0),
    );
    const rowAfter = account.row(server.serverId);
    record(
      "renewal",
      "a paid renewal moves the period end, and the server keeps running",
      after.status === "active" && rowAfter?.desired_state === "running" && rowAfter.observed_error !== "plan_ended",
      { before: before.currentPeriodEnd, after: after.currentPeriodEnd, status: after.status, row: rowAfter },
    );
  },

  async "failed-renewal"(account) {
    const { server } = await account.createServer("Failed renewal");
    const sub = await account.pay(server.serverId);
    await provisioned(account, server.serverId);
    const before = await planWhere(account, sub, "plan", () => true);
    await account.useCard("pm_card_chargeCustomerFail");
    const renewalAt = await account.advance(32);
    const pastDue = await planWhere(account, sub, "past_due", (plan) => plan.status === "past_due");
    const graceRow = account.row(server.serverId);
    record(
      "failed-renewal",
      "a failed renewal makes the plan past_due; the server keeps running while Stripe retries",
      graceRow?.desired_state === "running",
      {
        periodEndBefore: before.currentPeriodEnd,
        periodEndAfterFailure: pastDue.currentPeriodEnd,
        renewalAt: renewalAt * 1_000,
        row: graceRow,
      },
    );
    const renewWhileDue = await account.checkout(server.serverId);
    record(
      "failed-renewal",
      "a past_due server gets no second Checkout",
      renewWhileDue.status === 200 && renewWhileDue.checkoutUrl === null,
      renewWhileDue,
    );
    // The user pays the open invoice with a working card, as in the Customer Portal.
    const good = await account.useCard("pm_card_visa");
    const current = await subscription(sub);
    if (!current.latest_invoice) throw new Error("No open invoice");
    await stripe("POST", `/v1/invoices/${current.latest_invoice}/pay`, idSchema, { payment_method: good });
    const recovered = await planWhere(account, sub, "active again", (plan) => plan.status === "active");
    record("failed-renewal", "paying the open invoice makes the plan active again", true, recovered);
    // Now the renewal fails until Stripe gives up.
    await account.useCard("pm_card_chargeCustomerFail");
    const statuses: { afterDays: number; stripeStatus: string }[] = [];
    let final: string | null = null;
    for (let days = 32; days <= 92 && !final; days += 15) {
      await account.advance(days === 32 ? 32 : 15);
      await sleep(4_000);
      const stripeStatus = (await subscription(sub)).status;
      statuses.push({ afterDays: days, stripeStatus });
      if (stripeStatus === "canceled" || stripeStatus === "unpaid") final = stripeStatus;
    }
    const ended = final
      ? await rowWhere(account, server.serverId, "plan ended", (row) => row.desired_state === "stopped")
      : null;
    record(
      "failed-renewal",
      "when Stripe stops the retries, the server stops with plan_ended and is kept",
      ended?.observed_error === "plan_ended" && ended.deleted_at === null,
      { statuses, final, row: ended },
    );
    const renew = await account.checkout(server.serverId);
    record(
      "failed-renewal",
      "renew: 409 payment_due while an unpaid plan is open, else a new Checkout",
      renew.status === (final === "unpaid" ? 409 : 200),
      { status: renew.status, code: renew.code, hasUrl: Boolean(renew.checkoutUrl) },
    );
  },

  async "cancel-at-period-end"(account) {
    const { server } = await account.createServer("Cancel later");
    const sub = await account.pay(server.serverId);
    await provisioned(account, server.serverId);
    const portal = await account.portal("cancel", sub);
    record("cancel-at-period-end", "the Worker gives a Portal cancel page", portal.status === 200, {
      host: portal.url ? new URL(portal.url).host : null,
    });
    // The Portal with mode `at_period_end` makes the same change.
    await stripe("POST", `/v1/subscriptions/${sub}`, idSchema, { cancel_at_period_end: "true" });
    const cancelling = await planWhere(account, sub, "cancelAtPeriodEnd", (plan) => plan.cancelAtPeriodEnd);
    const row = account.row(server.serverId);
    record(
      "cancel-at-period-end",
      "cancel at period end: the plan shows the end date and the server keeps running",
      row?.desired_state === "running",
      { plan: cancelling, row },
    );
    await stripe("POST", `/v1/subscriptions/${sub}`, idSchema, { cancel_at_period_end: "false" });
    const undone = await planWhere(account, sub, "undo", (plan) => !plan.cancelAtPeriodEnd);
    record("cancel-at-period-end", "undo the cancel: the plan continues", undone.status === "active", undone);
    // A cancel at a set time, as the Portal can store it, shows the same as a cancel at the period end.
    await stripe("POST", `/v1/subscriptions/${sub}`, idSchema, {
      cancel_at: String((undone.currentPeriodEnd ?? 0) / 1_000),
    });
    const scheduled = await planWhere(account, sub, "cancel_at", (plan) => plan.cancelAtPeriodEnd);
    record("cancel-at-period-end", "a cancel with `cancel_at` also shows the end date", true, scheduled);
    await account.advance(32);
    const ended = await rowWhere(account, server.serverId, "stopped", (current) => current.desired_state === "stopped");
    record(
      "cancel-at-period-end",
      "at the period end the server stops with plan_ended; the row and its data stay",
      ended.observed_error === "plan_ended" && ended.deleted_at === null,
      { stripeStatus: (await subscription(sub)).status, row: ended, billingPlans: await account.billing() },
    );
  },

  async "plan-change"(account) {
    const { server } = await account.createServer("Plan change");
    const sub = await account.pay(server.serverId);
    await provisioned(account, server.serverId);
    const item = (await subscription(sub)).items.data[0]?.id;
    if (!item) throw new Error("No subscription item");
    // The Portal upgrade: a higher price now, charged now (`always_invoice`).
    await stripe("POST", `/v1/subscriptions/${sub}`, idSchema, {
      "items[0][id]": item,
      "items[0][price]": await priceId("pro", "month"),
      proration_behavior: "always_invoice",
    });
    const upgraded = await rowWhere(account, server.serverId, "pro", (row) => row.plan === "pro");
    record(
      "plan-change",
      "upgrade to Pro: the server plan follows; the prorated amount is invoiced at once",
      (await account.plan(sub))?.plan === "pro",
      { row: upgraded, invoices: await invoices(sub) },
    );
    await stripe("POST", `/v1/subscriptions/${sub}`, idSchema, {
      "items[0][id]": item,
      "items[0][price]": await priceId("pro", "year"),
      proration_behavior: "always_invoice",
    });
    const yearly = await rowWhere(account, server.serverId, "yearly", (row) => row.billing_interval === "year");
    record("plan-change", "month to year: the server interval follows", yearly.plan === "pro", yearly);
    // The Portal downgrade: a schedule changes the price at the period end.
    const schedule = await stripe("POST", "/v1/subscription_schedules", scheduleSchema, { from_subscription: sub });
    const phase = schedule.phases[0];
    if (!phase) throw new Error("No schedule phase");
    await stripe("POST", `/v1/subscription_schedules/${schedule.id}`, idSchema, {
      "phases[0][items][0][price]": await priceId("pro", "year"),
      "phases[0][start_date]": String(phase.start_date),
      "phases[0][end_date]": String(phase.end_date),
      "phases[1][items][0][price]": await priceId("standard", "year"),
      end_behavior: "release",
    });
    await sleep(5_000);
    const beforeEnd = account.row(server.serverId);
    record(
      "plan-change",
      "a downgrade waits for the period end: the server stays Pro",
      beforeEnd?.plan === "pro",
      beforeEnd,
    );
    await account.advance(370);
    const downgraded = await rowWhere(account, server.serverId, "standard", (row) => row.plan === "standard", 120_000);
    record(
      "plan-change",
      "after the period end the server plan is Standard and it keeps running",
      downgraded.desired_state === "running",
      downgraded,
    );
  },

  async renew(account) {
    const { server } = await account.createServer("Renew plan");
    const sub = await account.pay(server.serverId);
    await provisioned(account, server.serverId);
    await stripe("DELETE", `/v1/subscriptions/${sub}`, idSchema);
    const ended = await rowWhere(account, server.serverId, "ended", (row) => row.desired_state === "stopped");
    record("renew", "a cancel now stops the server with plan_ended", ended.observed_error === "plan_ended", ended);
    const woken = await account.request("POST", `v2/hosting/servers/${server.serverId}/wake`, {});
    record("renew", "start of a server whose plan ended: 402 plan_required", woken.status === 402, {
      status: woken.status,
      code: woken.code,
    });
    const renew = await account.checkout(server.serverId);
    record(
      "renew",
      "renew gives a new Checkout page",
      renew.status === 200 && Boolean(renew.checkoutUrl?.startsWith("https://checkout.stripe.com/")),
      { status: renew.status },
    );
    await account.pay(server.serverId);
    const renewed = await rowWhere(
      account,
      server.serverId,
      "running again",
      (row) =>
        row.desired_state === "running" &&
        row.observed_state !== "awaiting_payment" &&
        row.observed_state !== "creating",
    );
    record(
      "renew",
      "a paid renewal of a server with no sandbox sets it up again (no payment for a server that cannot start)",
      renewed.observed_error !== "plan_ended",
      renewed,
    );
  },

  async delete(account) {
    const { server } = await account.createServer("Delete paid");
    const sub = await account.pay(server.serverId);
    await provisioned(account, server.serverId);
    const deleted = await account.request("DELETE", `v2/hosting/servers/${server.serverId}`, {
      confirmName: "Delete paid",
    });
    const stripeSub = await subscription(sub);
    record(
      "delete",
      "delete of a paid server cancels its plan now, with no refund",
      deleted.status === 204 && stripeSub.status === "canceled",
      { status: deleted.status, stripeStatus: stripeSub.status, row: account.row(server.serverId) },
    );
    const unpaid = await account.createServer("Delete unpaid");
    const session = account.row(unpaid.server.serverId)?.checkout_session_id;
    if (!session) throw new Error("No Checkout page");
    const removed = await account.request("DELETE", `v2/hosting/servers/${unpaid.server.serverId}`, {
      confirmName: "Delete unpaid",
    });
    const page = await stripe("GET", `/v1/checkout/sessions/${session}`, checkoutSessionSchema);
    record(
      "delete",
      "delete of an unpaid server closes its Checkout page",
      removed.status === 204 && page.status === "expired",
      { status: removed.status, page: page.status },
    );
    // A payment that arrives after the delete (a page paid at the same moment) is cancelled.
    const late = await account.pay(unpaid.server.serverId);
    await waitFor("late cancelled", async () => (await subscription(late)).status === "canceled");
    record("delete", "a payment for a deleted server is cancelled at once", true, {
      row: account.row(unpaid.server.serverId),
    });
  },

  async foreign(account) {
    const victim = await new Account("renewal", account.api).setUp();
    const { server } = await victim.createServer("Victim");
    const sub = await account.pay(server.serverId);
    await sleep(8_000);
    const row = victim.row(server.serverId);
    const stored = d1(
      `SELECT user_id, server_id, status FROM billing_subscriptions WHERE stripe_subscription_id = ${quote(sub)}`,
      z.unknown(),
    );
    record(
      "foreign",
      "a subscription whose metadata names another account's server gives that server nothing",
      row?.observed_state === "awaiting_payment" && (await victim.billing()).length === 0,
      { row, stored },
    );
    await stripe("DELETE", `/v1/subscriptions/${sub}`, idSchema);
    await victim.tearDown();
    await stripe("DELETE", `/v1/test_helpers/test_clocks/${victim.clock}`, idSchema).catch(() => null);
  },

  /** The real Customer Portal pages: a person (or Playwright) uses the printed pages while this waits. */
  async portal(account) {
    const { server } = await account.createServer("Portal");
    const sub = await account.pay(server.serverId);
    await provisioned(account, server.serverId);
    print(`PORTAL_CANCEL ${(await account.portal("cancel", sub)).url}`);
    const cancelled = await waitFor(
      "Portal cancel",
      async () => {
        const plan = await account.plan(sub);
        return plan?.cancelAtPeriodEnd ? plan : null;
      },
      600_000,
    );
    const stored = await subscription(sub);
    record(
      "portal",
      "Portal cancel: the plan shows the end date",
      account.row(server.serverId)?.desired_state === "running",
      { plan: cancelled, stripe: { cancel_at_period_end: stored.cancel_at_period_end, cancel_at: stored.cancel_at } },
    );
    await stripe(
      "POST",
      `/v1/subscriptions/${sub}`,
      idSchema,
      stored.cancel_at_period_end ? { cancel_at_period_end: "false" } : { cancel_at: "" },
    );
    await planWhere(account, sub, "undo", (plan) => !plan.cancelAtPeriodEnd);
    print(`PORTAL_UPDATE ${(await account.portal("update", sub)).url}`);
    const upgraded = await rowWhere(
      account,
      server.serverId,
      "Portal upgrade",
      (row) => row.plan !== "starter",
      600_000,
    );
    record("portal", "Portal plan change: the server plan follows, and an upgrade is invoiced at once", true, {
      row: upgraded,
      invoices: await invoices(sub),
    });
  },

  async "customer-deleted"(account) {
    const old = account.customer;
    await stripe("DELETE", `/v1/customers/${old}`, idSchema);
    const created = await account.createServer("After delete");
    const [stored] = d1(
      `SELECT stripe_customer_id FROM billing_customers WHERE user_id = ${quote(account.id)}`,
      z.object({ stripe_customer_id: z.string() }),
    );
    const session = account.row(created.server.serverId)?.checkout_session_id;
    if (!session) throw new Error("No Checkout page");
    const page = await stripe("GET", `/v1/checkout/sessions/${session}`, checkoutSessionSchema);
    record(
      "customer-deleted",
      "a customer deleted in Stripe: the next Checkout uses a new customer",
      Boolean(created.checkoutUrl) &&
        stored?.stripe_customer_id !== old &&
        page.customer === stored?.stripe_customer_id,
      { oldReplaced: stored?.stripe_customer_id !== old },
    );
  },
  async boat(account) {
    const name = "Boat e2e";
    const { server, checkoutUrl } = await account.createServer(name);
    const serverId = server.serverId;
    let deleted = false;
    const sandbox = async (id: string) => {
      const response = await boat("GET", `/sandboxes/${id}`);
      return { status: response.status, ...sandboxSchema.safeParse(response.body).data?.sandbox };
    };
    const openPlan = () =>
      waitFor(
        "subscription stored",
        async () => {
          const [value] = d1(
            `SELECT stripe_subscription_id FROM billing_subscriptions
           WHERE server_id = ${quote(serverId)} AND status IN ('active', 'trialing') ORDER BY updated_at DESC LIMIT 1`,
            z.object({ stripe_subscription_id: z.string() }),
          );
          return value?.stripe_subscription_id;
        },
        600_000,
      );
    /** The real Checkout page with a test card, or a subscription with the server metadata. */
    let pages = 0;
    const pay = async (url: string | null | undefined) => {
      if (!REAL_CHECKOUT) return account.pay(serverId);
      if (!url) throw new Error("No Checkout page");
      pages += 1;
      const returned = await payCheckout(url, new URL(account.api).origin, `boat-e2e-checkout-${pages}.png`);
      print(`Checkout paid; returned to ${returned}`);
      return openPlan();
    };
    // The deployed Worker gets the boat webhooks and runs the cron each minute. A local Worker needs a push.
    const tick = () =>
      REMOTE_D1
        ? Promise.resolve()
        : fetch(`${account.api}/cdn-cgi/handler/scheduled?cron=*+*+*+*+*`).catch(() => null);
    const runningRow = (label: string, test: (row: Row) => boolean = () => true, timeoutMs = 600_000) =>
      waitFor(
        label,
        async () => {
          await tick();
          const row = account.row(serverId);
          return row?.observed_state === "running" && row.desired_state === "running" && test(row) ? row : null;
        },
        timeoutMs,
      );
    const serviceActive = async (sandboxId: string) => {
      const response = await boat("POST", `/sandboxes/${sandboxId}/commands`, {
        command: "systemctl is-active openbot.service; sudo -n journalctl -u openbot.service --no-pager -n 30 -o cat",
        timeoutSeconds: 60,
      });
      return commandSchema.safeParse(response.body).data?.stdout ?? "";
    };
    try {
      await pay(checkoutUrl);
      const created = await rowWhere(
        account,
        serverId,
        "sandbox",
        (row) => row.provider_sandbox_id !== null || row.observed_state === "error",
        120_000,
      );
      const sandboxId = created.provider_sandbox_id;
      record(
        "boat",
        `payment (${REAL_CHECKOUT ? "Checkout page, test card" : "subscription"}) creates one boat VM from the template`,
        sandboxId !== null,
        created,
      );
      if (!sandboxId) return;
      const running = await runningRow("running");
      record("boat", "the VM reaches running", true, running);
      const host = await waitFor(
        "claim redeemed and host published",
        async () => {
          const [value] = d1(
            `SELECT h.claim_redeemed_at, r.name AS host_name, r.device_public_key IS NOT NULL AS published
             FROM hosted_servers h
             LEFT JOIN remote_hosts r ON r.host_id = h.server_id AND r.owner_user_id = h.owner_user_id
             WHERE h.server_id = ${quote(serverId)}`,
            hostSchema,
          );
          return value?.claim_redeemed_at && value.published ? value : null;
        },
        900_000,
      );
      record(
        "boat",
        "OpenBot in the VM redeems its claim and publishes the host with the server name",
        host.host_name === name,
        host,
      );
      const output = await serviceActive(sandboxId);
      record("boat", "openbot.service is active in the VM", output.startsWith("active"), output.split("\n"));
      // The claim works one time, so a server that did not store its session cannot sign in again. The
      // app signs in before it starts the host, so 60 seconds of a clean log is a complete start.
      const restart = await boat("POST", `/sandboxes/${sandboxId}/commands`, {
        command: [
          'test -s "$HOME/.config/OpenBot/openbot-central-auth-v1.bin" || { echo "no stored session"; exit 1; }',
          "sudo -n systemctl restart openbot.service",
          "id=$(systemctl show -p InvocationID --value openbot.service)",
          "for _ in $(seq 1 30); do",
          '  if sudo -n journalctl "_SYSTEMD_INVOCATION_ID=$id" -o cat --no-pager | grep -q "could not sign in"; then',
          '    echo "sign-in failed"; exit 1',
          "  fi",
          "  sleep 2",
          "done",
          "systemctl is-active openbot.service",
        ].join("\n"),
        timeoutSeconds: 120,
      });
      const restarted = commandSchema.safeParse(restart.body).data?.stdout?.trim() ?? "";
      record("boat", "the stored session signs the server in again after a restart", restarted === "active", {
        output: restarted,
      });

      const web = await connectWeb(account, serverId, name, "boat-e2e-web-connected.png");
      record(
        "boat",
        "the web client connects to the server over Signal, and the server reports the use",
        web.peers.some((peer) => peer.state === "connected") && web.activityReportedAfterMs !== null,
        web,
      );

      // The page is closed, so the server reports no use. It stops 15 minutes after its last use.
      const idleSince = Date.now();
      const idle = await rowWhere(
        account,
        serverId,
        "idle stop",
        (row) => row.desired_state === "idle" && row.observed_state === "stopped",
        30 * 60_000,
      );
      const idleBoat = await sandbox(sandboxId);
      record(
        "boat",
        "with no use for 15 minutes the server stops and boat keeps the VM",
        idleBoat.status === 200 && idleBoat.state !== "deleted",
        { minutes: Math.round((Date.now() - idleSince) / 6_000) / 10, row: idle, boat: idleBoat },
      );
      await sleep(90_000);
      const stillIdle = account.row(serverId);
      record(
        "boat",
        "the cron and the boat webhook do not start an idle server",
        stillIdle?.desired_state === "idle" && stillIdle.observed_state === "stopped",
        stillIdle,
      );
      const woken = await account.request("POST", `v2/hosting/servers/${serverId}/wake`, {});
      const awake = await runningRow("running after wake");
      const again = await connectWeb(account, serverId, name, "boat-e2e-web-after-wake.png");
      record(
        "boat",
        "Start (wake) resumes the idle server with the same VM, and the web client connects again",
        awake.provider_sandbox_id === sandboxId && again.peers.some((peer) => peer.state === "connected"),
        { status: woken.status, row: awake, web: again },
      );

      // A plan change: Starter (small) to Standard (default). The server stops and resumes on the new type.
      const sub = await openPlan();
      const item = (await subscription(sub)).items.data[0]?.id;
      if (!item) throw new Error("No subscription item");
      await stripe("POST", `/v1/subscriptions/${sub}`, idSchema, {
        "items[0][id]": item,
        "items[0][price]": await priceId("standard", "month"),
        proration_behavior: "always_invoice",
      });
      const resized = await runningRow("resized", (row) => row.size === "default");
      const resizedBoat = await sandbox(sandboxId);
      const resizedWeb = await connectWeb(account, serverId, name, "boat-e2e-web-after-resize.png");
      record(
        "boat",
        "Starter to Standard: the server moves to the boat default type, and the web client connects again",
        resized.plan === "standard" &&
          resizedBoat.type === "default" &&
          resized.provider_sandbox_id === sandboxId &&
          resizedWeb.peers.some((peer) => peer.state === "connected"),
        { row: resized, boat: resizedBoat, web: resizedWeb },
      );

      // The plan ends now: the server stops with plan_ended, and the VM stays.
      await stripe("DELETE", `/v1/subscriptions/${sub}`, idSchema);
      const ended = await rowWhere(
        account,
        serverId,
        "plan ended",
        (row) => row.desired_state === "stopped" && row.observed_state === "stopped",
        600_000,
      );
      const endedBoat = await sandbox(sandboxId);
      record(
        "boat",
        "cancel: the server stops with plan_ended; the row and the VM stay",
        ended.observed_error === "plan_ended" &&
          ended.deleted_at === null &&
          endedBoat.status === 200 &&
          endedBoat.state !== "deleted",
        { row: ended, boat: endedBoat },
      );
      const refused = await account.request("POST", `v2/hosting/servers/${serverId}/wake`, {});
      record("boat", "a connect to a server whose plan ended: 402 plan_required", refused.status === 402, {
        status: refused.status,
        code: refused.code,
      });

      // Renew: a new plan starts the same VM again.
      const renew = await account.checkout(serverId);
      await pay(renew.checkoutUrl);
      const renewed = await runningRow("renewed");
      const renewedWeb = await connectWeb(account, serverId, name, "boat-e2e-web-after-renew.png");
      record(
        "boat",
        "renew: the paid plan starts the same VM again, and the web client connects",
        renewed.provider_sandbox_id === sandboxId &&
          renewed.observed_error === null &&
          renewedWeb.peers.some((peer) => peer.state === "connected"),
        { checkout: renew.status, row: renewed, web: renewedWeb },
      );

      const removed = await account.request("DELETE", `v2/hosting/servers/${serverId}`, { confirmName: name });
      deleted = removed.status === 204;
      const gone = await waitFor(
        "VM deleted",
        async () => {
          const current = await sandbox(sandboxId);
          return current.status === 404 || current.state === "deleted" ? current : null;
        },
        180_000,
      );
      record("boat", "delete removes the VM and cancels the plan", deleted, {
        status: removed.status,
        boat: gone,
        row: account.row(serverId),
        plans: await account.billing(),
      });
    } finally {
      if (!deleted) await account.request("DELETE", `v2/hosting/servers/${serverId}`, { confirmName: name });
    }
  },
};

function previousSteps(): Step[] {
  try {
    return z.object({ steps: z.array(stepSchema) }).parse(JSON.parse(readFileSync(REPORT, "utf8"))).steps;
  } catch {
    return [];
  }
}

async function main(args: string[]) {
  if (args.includes("--print-user-ids")) {
    print(SCENARIOS.map(userId).join(","));
    return;
  }
  const api = args[args.indexOf("--api") + 1];
  if (!args.includes("--api") || !api) throw new Error("Pass --api <Worker origin>.");
  const chosen = SCENARIOS.filter((scenario) => args.includes(scenario));
  // A real VM costs money, so `boat` runs only when named.
  const run = chosen.length > 0 ? chosen : SCENARIOS.filter((scenario) => scenario !== "boat");
  const clocks: string[] = [];
  for (const scenario of run) {
    let account: Account | null = null;
    try {
      account = await new Account(scenario, api).setUp();
      clocks.push(account.clock);
      await scenarios[scenario](account);
    } catch (error) {
      record(scenario, "scenario finished", false, error instanceof Error ? error.message : String(error));
    } finally {
      await account?.tearDown().catch((error: unknown) => {
        record(scenario, "servers deleted", false, error instanceof Error ? error.message : String(error));
      });
    }
  }
  if (chrome) await (await chrome).close();
  // Deleting a test clock deletes its customers and subscriptions.
  for (const clock of clocks)
    await stripe("DELETE", `/v1/test_helpers/test_clocks/${clock}`, idSchema).catch(() => null);
  mkdirSync(join(ROOT, ".openbot-build"), { recursive: true });
  const kept = previousSteps().filter((step) => !run.includes(step.scenario));
  writeFileSync(
    REPORT,
    `${JSON.stringify({ run: new Date().toISOString(), api, steps: [...kept, ...steps] }, null, 2)}\n`,
  );
  print(`Report: ${REPORT}`);
  if (steps.some((step) => step.result === "fail")) process.exitCode = 1;
}

await main(process.argv.slice(2));
