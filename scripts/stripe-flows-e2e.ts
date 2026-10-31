/**
 * End-to-end check of the hosted server plan flows against the Stripe sandbox and a local account Worker.
 * Each scenario gets its own account and a Stripe test clock, so renewals and period ends happen at once.
 * A subscription made here with the server metadata stands for a paid Checkout page: the Worker reads
 * only the subscription webhooks. Local development data only. On the `test` Worker each paid server is
 * a real boat VM, so the check deletes the servers of each scenario when it ends.
 *
 *   bun scripts/stripe-flows-e2e.ts --api http://127.0.0.1:<port> [scenario ...]
 *
 * The Worker must run with `HOSTED_SERVERS_ALLOWED_USER_IDS` set to the IDs that `--print-user-ids`
 * prints, and `stripe listen` must forward to it. The `portal` scenario prints two Customer Portal
 * pages and waits until someone uses them. The report goes to `.openbot-build/stripe-flows-e2e.json`.
 *
 * The `boat` scenario runs only when named. It makes a real VM: the Worker needs the real `BOAT_API_KEY`
 * and `HOSTED_SERVER_TEMPLATE`, and the template must know a public origin of this Worker. It waits
 * until OpenBot in the VM redeems its claim and publishes its host. Then it keeps a focused web client
 * open with no input for 20 minutes and checks that the server stays on, waits for the idle stop
 * (about 15 minutes), starts the server, changes the plan, ends it, renews it, and deletes the server.
 * `--checkout` pays each Checkout page with a test card in the local Chrome. The web client then
 * connects to the server over Signal, and the screenshots go to `.openbot-build/`.
 * `--remote-d1` reads the D1 of the deployed `test` Worker; pass its origin as `--api`.
 *
 * The `license-*` scenarios check the commercial license: its tiered Price, Checkout, users, the count
 * of people on the owner's servers, renewal, currency, and that the server plans do not change. They need
 * `bun run api:stripe:bootstrap` to have made the license Prices in the sandbox. A subscription made here
 * with the license metadata stands for a paid license Checkout page, as for a server plan.
 *
 * The license tiers have their own scenarios:
 * - `license-prices`: the 8 license lookup keys give active Prices with the tier, the interval, the bundle
 *   flag and the amounts of `LICENSE_PLAN_PRICES` in EUR, USD and PLN. No license key is a server plan key.
 * - `license-starter`: a Starter license is 1 user at €10. It cannot change its users, its server with no
 *   plan shows a member limit of 1, and no member joins.
 * - `license-bundle-align`: an account with a server plan buys the Starter license at the bundle price
 *   (€8). When the server plan ends, the license moves to the Starter price, and the next renewal is €10.
 * - `order-bundle`: a server create with a license order gives one Checkout page with the server Price and
 *   the Team bundle Price. After the payment the license moves to its own subscription with no second
 *   charge, renews with the server, and a second license order is refused.
 * - `license-team-year`: a yearly Team license of 7 users. The state, the invoice and the sales facts
 *   show the yearly interval.
 * - `license-upgrade`: Starter → Team monthly → Team yearly. A move to a lower plan is refused.
 * - `license-legacy-request`: a checkout request from an app before the tiers buys Team monthly (5 users at €70).
 * - `license-member-limits`: a new Starter hosted server takes 1 member (the owner), and a new Standard
 *   server takes 5. A server made before these limits (`legacy_member_limits = 1`) takes 3 on Starter and
 *   10 on Standard.
 * - `license-self-hosted-limit`: a server with no plan takes 3 members with no license, the users of a
 *   Team license while it is active, and 3 again when it ends. Members who are active stay. A custom limit
 *   above the license users shows the license users, and a plan from before the license gives way to more
 *   license users.
 *
 * The license promotion (`LICENSE_TRIAL_END`, in `wrangler.jsonc`) has its own scenarios. They run only
 * when the Worker sells the free trial, and `order-bundle` runs only when it does not. To run
 * `order-bundle`, start the Worker with `LICENSE_TRIAL_END=` (empty).
 * - `license-trial`: the license state gives the trial end, and the license Checkout page charges 0 now.
 *   The paid page makes a trialing license that ends on the trial end, with no charge.
 * - `order-trial`: a server order with a license gives a Checkout page with the server Price only, and
 *   the order in its metadata. After the payment a trialing license of the order starts on its own
 *   subscription, the order metadata leaves the server subscription, and a second order is refused.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  BILLING_CURRENCIES,
  type BillingCurrency,
  type BillingPlanId,
  type BillingPortalRequest,
  LEGACY_MEMBER_LIMITS,
  memberLimitForPlan,
  parseBillingLookupKey,
} from "@openbot/contracts/billing";
import { DEFAULT_TEAM_MEMBER_LIMIT } from "@openbot/contracts/input-limits";
import {
  LICENSE_INCLUDED_USERS,
  LICENSE_LOOKUP_KEYS,
  LICENSE_MAX_USERS,
  LICENSE_METADATA,
  LICENSE_METADATA_KIND,
  LICENSE_PLANS,
  type LicenseCheckoutRequest,
  type LicenseOrder,
  type LicensePlan,
  type LicensePlanRequest,
  type LicenseRenewalRequest,
  type LicenseUsersRequest,
  licenseIncludedUsers,
  licenseLookupKey,
  licenseMonthlyAmount,
  licensePeriodAmount,
  licensePlanPrice,
  ORDER_METADATA,
} from "@openbot/contracts/license";
import { type Browser, chromium } from "playwright-core";
import { z } from "zod";
import { STRIPE_API_VERSION } from "../apps/auth-api/src/server/stripe-client";
import { developmentChildEnvironment, loadSharedDevelopmentEnvironment } from "./development-environment";

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
  "refund",
  "dispute",
  "portal",
  "welcome",
  "boat",
  "license-buy",
  "license-checkout",
  "license-double-checkout",
  "license-users",
  "license-count",
  "license-renewal",
  "license-failed-renewal",
  "license-currency",
  "license-isolation",
  "license-limit",
  "license-prices",
  "license-starter",
  "license-bundle-align",
  "order-bundle",
  "license-team-year",
  "license-upgrade",
  "license-legacy-request",
  "license-member-limits",
  "license-self-hosted-limit",
  "license-trial",
  "order-trial",
] as const;
type Scenario = (typeof SCENARIOS)[number];
const DAY = 86_400;
const STARTER_MONTH: LicensePlan = { tier: "starter", interval: "month", bundle: false };
const STARTER_BUNDLE_MONTH: LicensePlan = { tier: "starter", interval: "month", bundle: true };
const TEAM_MONTH: LicensePlan = { tier: "team", interval: "month", bundle: false };
const TEAM_BUNDLE_MONTH: LicensePlan = { tier: "team", interval: "month", bundle: true };
const TEAM_YEAR: LicensePlan = { tier: "team", interval: "year", bundle: false };
/** `WELCOME_EMAIL_CLAIM_PREFIX` of `billing-service.ts`. That module needs the Worker types. */
const WELCOME_EMAIL_CLAIM_PREFIX = "openbot_welcome_email:";

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
  data: z.array(
    z.object({ id: z.string(), billing_reason: z.string().nullable(), status: z.string(), amount_paid: z.number() }),
  ),
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
const invoicePaymentsSchema = z.object({
  data: z.array(z.object({ payment: z.object({ payment_intent: z.string().nullable().optional() }) })),
});
const refundSchema = z.object({ id: z.string(), status: z.string() });
const disputeListSchema = z.object({ data: z.array(z.object({ id: z.string(), status: z.string() })) });
const eventListSchema = z.object({
  data: z.array(z.object({ id: z.string(), data: z.object({ object: z.object({ id: z.string() }) }) })),
});
const factSchema = z.object({ source_key: z.string(), fact_type: z.string(), attributes_json: z.string() });
const licenseStateSchema = z.object({
  available: z.boolean(),
  currency: z.string().nullable(),
  license: z
    .object({
      subscriptionId: z.string(),
      users: z.number(),
      currency: z.string(),
      amount: z.number(),
      tier: z.string().optional(),
      interval: z.string().optional(),
      bundle: z.boolean().optional(),
      status: z.string(),
      currentPeriodEnd: z.number().nullable(),
      cancelAtPeriodEnd: z.boolean(),
    })
    .nullable(),
  used: z.number(),
  users: z.array(
    z.object({ name: z.string().nullable(), email: z.string(), servers: z.array(z.string()), owner: z.boolean() }),
  ),
  coveredBy: z.array(z.object({ ownerName: z.string().nullable(), ownerEmail: z.string() })),
  bundle: z.boolean().optional(),
  trialEnd: z.number().optional(),
});
type LicenseView = z.infer<typeof licenseStateSchema>;
const licenseCheckoutSchema = z.object({ url: z.string() });
const tierSchema = z.object({
  up_to: z.number().nullable(),
  flat_amount: z.number().nullable(),
  unit_amount: z.number().nullable(),
});
const licensePriceSchema = z.object({
  id: z.string(),
  active: z.boolean(),
  lookup_key: z.string().nullable(),
  currency: z.string(),
  unit_amount: z.number().nullable(),
  tiers_mode: z.string().nullable(),
  tiers: z.array(tierSchema).optional(),
  recurring: z.object({ interval: z.string() }).nullable(),
  metadata: z.record(z.string(), z.string()),
  currency_options: z
    .record(
      z.string(),
      z.object({ unit_amount: z.number().nullable().optional(), tiers: z.array(tierSchema).optional() }),
    )
    .optional(),
});
type LicensePriceView = z.infer<typeof licensePriceSchema>;
const checkoutLinesSchema = z.object({
  status: z.string().nullable(),
  currency: z.string().nullable(),
  amount_total: z.number().nullable(),
  metadata: z.record(z.string(), z.string()).nullable(),
  line_items: z.object({
    data: z.array(
      z.object({
        quantity: z.number().nullable(),
        price: z.object({ id: z.string(), lookup_key: z.string().nullable() }),
      }),
    ),
  }),
});
const licenseItemSchema = z.object({
  items: z.object({
    data: z.array(
      z.object({
        id: z.string(),
        quantity: z.number().nullable().optional(),
        price: z.object({ id: z.string(), lookup_key: z.string().nullable() }),
      }),
    ),
  }),
});
const licenseRowSchema = z.object({ tier: z.string().nullable(), billing_interval: z.string().nullable() });
const hostListSchema = z.object({ hosts: z.array(z.object({ hostId: z.string(), memberLimit: z.number() })) });

/** The request bodies of the browser API routes that this check calls. */
type BrowserApiBody =
  | { name: string; plan: BillingPlanId; interval: "month"; currency: "eur"; license?: LicenseOrder }
  | { confirmName: string }
  | BillingPortalRequest
  | LicenseCheckoutRequest
  | LicenseUsersRequest
  | LicensePlanRequest
  | LicenseRenewalRequest
  | { role: "member"; reactivate?: true }
  | { token: string }
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

/** The `boat` scenario only. The shared development key reads the VM of the test server. */
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
  const env = developmentChildEnvironment(process.env, "app");
  if (REMOTE_D1) delete env.CLOUDFLARE_API_TOKEN;
  const result = spawnSync(
    join(ROOT, "node_modules/.bin/wrangler"),
    ["d1", "execute", ...target, "--json", "--command", sql],
    { cwd: join(ROOT, "apps/auth-api"), encoding: "utf8", env },
  );
  if (result.status !== 0) {
    // spawnSync leaves stderr undefined when it cannot start wrangler. Report that error, not a TypeError.
    const detail = result.stderr?.slice(0, 400) || result.error?.message || `exit ${String(result.status)}`;
    throw new Error(`D1 failed: ${detail}`);
  }
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
    for (const row of left) {
      const { status } = await boat("DELETE", `/sandboxes/${row.provider_sandbox_id}`);
      if (status >= 300 && status !== 404) throw new Error(`boat did not delete the VM that a run left: ${status}.`);
    }
    d1(
      [
        `DELETE FROM hosted_servers WHERE owner_user_id = ${id}`,
        `DELETE FROM billing_subscriptions WHERE user_id = ${id}`,
        `DELETE FROM licenses WHERE user_id = ${id}`,
        // The servers and members that a license scenario adds. Deleting a host deletes its memberships.
        `DELETE FROM remote_hosts WHERE host_id LIKE ${quote(`e2e-${this.scenario}-%`)}`,
        // The hosts that a scenario adds for its hosted servers have the server ID.
        `DELETE FROM remote_hosts WHERE owner_user_id = ${id}`,
        `DELETE FROM users WHERE id LIKE ${quote(`${this.id}-member-%`)}`,
        `DELETE FROM billing_customers WHERE user_id = ${id}`,
        `DELETE FROM auth_sessions WHERE user_id = ${id}`,
        `DELETE FROM billing_webhook_events WHERE event_id = ${quote(`${WELCOME_EMAIL_CLAIM_PREFIX}${this.id}`)}`,
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
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: BrowserApiBody,
    headers: Record<string, string> = {},
    token = this.token,
  ) {
    const response = await fetch(`${this.api}/api/browser/${path}`, {
      method,
      headers: {
        Cookie: `__Host-openbot-web=${token}`,
        ...(method === "GET" ? {} : { Origin: this.api, "X-OpenBot-Browser": "1", "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = z.unknown().parse(await response.json().catch(() => null));
    return { status: response.status, body: value, code: errorSchema.safeParse(value).data?.error.code ?? null };
  }

  async createServer(name: string) {
    const response = await this.orderServer(name, "standard");
    if (response.status !== 201) throw new Error(`create ${response.status}: ${response.code}`);
    return createdSchema.parse(response.body);
  }

  /** A server create request, monthly in EUR, with a license order when one is given. */
  orderServer(name: string, plan: BillingPlanId, license?: LicenseOrder) {
    return this.request(
      "POST",
      "v2/hosting/servers",
      { name, plan, interval: "month", currency: "eur", ...(license ? { license } : {}) },
      { "Idempotency-Key": `e2e-${this.scenario}-${randomBytes(8).toString("hex")}` },
    );
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
      "items[0][price]": await priceId("standard", "month"),
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

  async license(): Promise<LicenseView> {
    return licenseStateSchema.parse((await this.request("GET", "v1/me/license")).body);
  }

  /**
   * Buys a license as a completed Checkout page does: a subscription of the Price of the plan, with the
   * user count as its quantity and the license metadata that the Worker puts on the Checkout page. With
   * `trialEnd` (ms) the license is free until then, as during the promotion.
   */
  async buyLicense(
    users: number,
    currency: BillingCurrency = "eur",
    plan: LicensePlan = TEAM_MONTH,
    trialEnd?: number,
  ) {
    const created = await stripe("POST", "/v1/subscriptions", idSchema, {
      ...(trialEnd === undefined ? {} : { trial_end: String(Math.floor(trialEnd / 1_000)) }),
      customer: this.customer,
      "items[0][price]": await licensePriceId(plan),
      "items[0][quantity]": String(users),
      currency,
      "metadata[openbot_user_id]": this.id,
      [`metadata[${LICENSE_METADATA.kind}]`]: LICENSE_METADATA_KIND,
      [`metadata[${LICENSE_METADATA.tier}]`]: plan.tier,
      [`metadata[${LICENSE_METADATA.interval}]`]: plan.interval,
      [`metadata[${LICENSE_METADATA.bundle}]`]: String(plan.bundle),
      payment_behavior: "error_if_incomplete",
    });
    return created.id;
  }

  /**
   * Pays for a server order as a completed Checkout page does: the open page closes, and one subscription
   * starts with the server Price and the license bundle Price. It has the server metadata only. With
   * `trialEnd` (ms) it is an order of the promotion: the server Price only, and the order metadata.
   */
  async payOrder(serverId: string, plan: BillingPlanId, license: LicenseOrder, trialEnd?: number) {
    const session = this.row(serverId)?.checkout_session_id;
    if (session) await stripe("POST", `/v1/checkout/sessions/${session}/expire`, idSchema).catch(() => null);
    const created = await stripe("POST", "/v1/subscriptions", idSchema, {
      customer: this.customer,
      "items[0][price]": await priceId(plan, "month"),
      ...(trialEnd === undefined
        ? {
            "items[1][price]": await licensePriceId({ tier: license.tier, interval: "month", bundle: true }),
            "items[1][quantity]": String(license.users),
          }
        : {
            [`metadata[${ORDER_METADATA.licenseTier}]`]: license.tier,
            [`metadata[${ORDER_METADATA.licenseUsers}]`]: String(license.users),
            [`metadata[${ORDER_METADATA.licenseInterval}]`]: "month",
            [`metadata[${ORDER_METADATA.licenseTrialEnd}]`]: String(Math.floor(trialEnd / 1_000)),
          }),
      currency: "eur",
      "metadata[openbot_user_id]": this.id,
      "metadata[openbot_server_id]": serverId,
      payment_behavior: "error_if_incomplete",
    });
    return created.id;
  }

  /**
   * Adds the Remote host of a hosted server, with the owner's membership, as the server does when it
   * publishes its host. A local Worker has no VM that publishes it.
   */
  hostServer(serverId: string, name: string) {
    const now = Date.now();
    d1(
      `INSERT OR IGNORE INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
       VALUES (${quote(serverId)}, ${quote(this.id)}, ${quote(name)}, ${now}, ${now});
       INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
       SELECT ${quote(crypto.randomUUID())}, ${quote(serverId)}, ${quote(this.id)}, 'owner', 'active', ${now}, ${now}
       WHERE NOT EXISTS(SELECT 1 FROM remote_memberships WHERE host_id = ${quote(serverId)} AND user_id = ${quote(this.id)})`,
      z.unknown(),
    );
  }

  /**
   * Adds servers that this account owns, with members. A member is a new account; `active: false` adds
   * a revoked membership. The same key on two servers is one person.
   */
  addServers(servers: { name: string; members: { key: string; active?: boolean }[] }[]) {
    const now = Date.now();
    const statements: string[] = [];
    const people = new Set<string>();
    servers.forEach((server, index) => {
      const hostId = `e2e-${this.scenario}-${index}`;
      statements.push(
        `INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
         VALUES (${quote(hostId)}, ${quote(this.id)}, ${quote(server.name)}, ${now}, ${now})`,
        // The owner's own membership. It must not count twice.
        `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
         VALUES (${quote(crypto.randomUUID())}, ${quote(hostId)}, ${quote(this.id)}, 'owner', 'active', ${now}, ${now})`,
      );
      for (const member of server.members) {
        const memberId = this.memberId(member.key);
        if (!people.has(memberId)) {
          people.add(memberId);
          statements.push(
            `INSERT OR IGNORE INTO users(id, identity_key, email, name, created_at, updated_at)
             VALUES (${quote(memberId)}, ${quote(`e2e:${memberId}`)}, ${quote(`${memberId}@example.com`)},
                     ${quote(`Member ${member.key}`)}, ${now}, ${now})`,
          );
        }
        statements.push(
          `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
           VALUES (${quote(crypto.randomUUID())}, ${quote(hostId)}, ${quote(memberId)}, 'member',
                   ${member.active === false ? "'revoked'" : "'active'"}, ${now}, ${now})`,
        );
      }
    });
    d1(statements.join("; "), z.unknown());
  }

  memberId(key: string) {
    return `${this.id}-member-${key}`;
  }

  /** A browser session of a member of this account's servers. A new key is a new account. */
  memberSession(key: string) {
    const token = randomBytes(24).toString("base64url");
    const now = Date.now();
    const memberId = this.memberId(key);
    d1(
      `INSERT OR IGNORE INTO users(id, identity_key, email, name, created_at, updated_at)
       VALUES (${quote(memberId)}, ${quote(`e2e:${memberId}`)}, ${quote(`${memberId}@example.com`)},
               ${quote(`Member ${key}`)}, ${now}, ${now});
       INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
       VALUES (${quote(crypto.randomUUID())}, ${quote(memberId)},
               ${quote(createHash("sha256").update(token).digest("base64url"))}, ${now + DAY * 1_000}, ${now}, ${now})`,
      z.unknown(),
    );
    return token;
  }

  /** The license state that a member of this account's servers sees. */
  async memberLicense(key: string): Promise<LicenseView> {
    return licenseStateSchema.parse(
      (await this.request("GET", "v1/me/license", undefined, {}, this.memberSession(key))).body,
    );
  }

  /** A member opens a new member invitation of the server at this `addServers` index. */
  async memberJoins(key: string, server: number) {
    return this.joinHost(key, `e2e-${this.scenario}-${server}`);
  }

  /** A member opens a new member invitation of the host with this ID. */
  async joinHost(key: string, hostId: string) {
    const invite = await this.request("POST", `v2/remote/hosts/${hostId}/invites`, { role: "member" });
    const token = z.object({ token: z.string() }).parse(invite.body).token;
    return this.request("POST", "v2/remote/invites/accept", { token }, {}, this.memberSession(key));
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
  chrome ??= chromium.launch({
    channel: "chrome",
    headless: true,
    env: Object.fromEntries(
      Object.entries(developmentChildEnvironment(process.env, "app")).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  });
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
 * connected, and then waits for the server's next activity report. With `holdMs`, it keeps the focused
 * page open with no input for that long and reads the server row each minute. Closing the page ends the use.
 */
async function connectWeb(account: Account, serverId: string, name: string, screenshot: string, holdMs = 0) {
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
    const held: { atMinute: number; desiredState: string | null; lastActiveAt: number | null; focused: boolean }[] = [];
    if (holdMs > 0) await page.bringToFront();
    while (Date.now() - connectedAt < holdMs) {
      await sleep(60_000);
      const row = account.row(serverId);
      held.push({
        atMinute: Math.round((Date.now() - connectedAt) / 60_000),
        desiredState: row?.desired_state ?? null,
        lastActiveAt: row?.last_active_at ?? null,
        focused: await page.evaluate(() => !document.hidden && document.hasFocus()),
      });
    }
    return {
      connectMs: connectedAt - start,
      peers,
      activityReportedAfterMs: reported ? reported - connectedAt : null,
      held,
    };
  } finally {
    await context.close();
  }
}

const priceIds = new Map<string, string>();
/** The active Price of a server plan and interval. */
function priceId(plan: string, interval: string): Promise<string> {
  return priceIdByLookupKey(`openbot_${plan}_${interval}`);
}

/** The active Price of a license plan. Team monthly keeps the key of the license from before the tiers. */
function licensePriceId(plan: LicensePlan): Promise<string> {
  return priceIdByLookupKey(licenseLookupKey(plan));
}

async function priceIdByLookupKey(key: string): Promise<string> {
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
  const list = await stripe("GET", "/v1/invoices", invoiceListSchema, { subscription: subscriptionId, limit: "10" });
  return list.data.map((invoice) => ({
    id: invoice.id,
    reason: invoice.billing_reason,
    status: invoice.status,
    amount: invoice.amount_paid,
  }));
}

/** The PaymentIntent that paid the latest invoice of the plan. */
async function paymentIntent(subscriptionId: string) {
  const invoice = (await subscription(subscriptionId)).latest_invoice;
  if (!invoice) throw new Error("No invoice");
  const payments = await stripe("GET", "/v1/invoice_payments", invoicePaymentsSchema, { invoice });
  const intent = payments.data[0]?.payment.payment_intent;
  if (!intent) throw new Error("The invoice has no PaymentIntent");
  return { invoice, intent };
}

/** Waits until Stripe sent the event of this type about this object and the Worker applied it. */
async function applied(type: string, objectId: string, timeoutMs = 120_000) {
  // A test refund fails about two minutes after Stripe accepts it.
  const event = await waitFor(
    `${type} ${objectId}`,
    async () => {
      const list = await stripe("GET", "/v1/events", eventListSchema, { type, limit: "20" });
      return list.data.find((entry) => entry.data.object.id === objectId) ?? null;
    },
    timeoutMs,
  );
  await waitFor(
    `Worker applied ${event.id}`,
    async () =>
      d1(`SELECT 1 AS seen FROM billing_webhook_events WHERE event_id = ${quote(event.id)}`, z.unknown()).length > 0,
    timeoutMs,
  );
  return event.id;
}

/** The sales facts of an invoice. The Worker records them only when OpenPanel is set. */
function facts(invoiceId: string) {
  return d1(
    `SELECT source_key, fact_type, attributes_json FROM billing_sales_facts
     WHERE invoice_id = ${quote(invoiceId)} ORDER BY event_timestamp, source_key`,
    factSchema,
  );
}

const factAttributesSchema = z.object({ product: z.string().optional(), interval: z.string().optional() });

/** The product and interval of a sales fact, or null for a value that is not JSON. */
function factAttributes(json: string) {
  try {
    return factAttributesSchema.safeParse(JSON.parse(json)).data ?? null;
  } catch {
    return null;
  }
}

/** True when the Worker records sales facts: the paid invoice gets its fact soon after the payment. */
async function recordsSales(invoiceId: string) {
  return waitFor(
    "payment fact",
    async () => facts(invoiceId).some((fact) => fact.fact_type === "payment_succeeded"),
    20_000,
  ).catch(() => false);
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

/** The claim that the Worker records when it sends the welcome email of an account. */
function welcomeClaims(account: Account) {
  return d1(
    `SELECT event_id, type, received_at FROM billing_webhook_events
     WHERE event_id = ${quote(`${WELCOME_EMAIL_CLAIM_PREFIX}${account.id}`)}`,
    welcomeClaimSchema,
  );
}

const observabilitySchema = z.object({ result: z.object({ rows: z.array(z.tuple([z.string()])) }) });

/**
 * The welcome email results that a local Worker logged since `since`: one line for each send. Only
 * `bun run dev:api` has this log query, so `--remote-d1` reads nothing.
 */
async function welcomeSends(api: string, since: number) {
  const response = await fetch(`${api}/cdn-cgi/local/explorer/api/local/observability/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sql: `SELECT message FROM logs WHERE message LIKE '%billing: welcome email%' AND ts_ms >= ${since}`,
    }),
  });
  return observabilitySchema.parse(await response.json()).result.rows.map(([message]) => message);
}

function planWhere(account: Account, subscriptionId: string, label: string, test: (plan: Plan) => boolean) {
  return waitFor(label, async () => {
    const plan = await account.plan(subscriptionId);
    return plan && test(plan) ? plan : null;
  });
}

const welcomeClaimSchema = z.object({ event_id: z.string(), type: z.string(), received_at: z.number() });

function licenseWhere(account: Account, label: string, test: (state: LicenseView) => boolean, timeoutMs?: number) {
  return waitFor(
    label,
    async () => {
      const state = await account.license();
      return test(state) ? state : null;
    },
    timeoutMs,
  );
}

/** The license rows in `billing_subscriptions`. There must be none: a license has its own table. */
function licenseInPlans(subscriptionId: string) {
  return d1(
    `SELECT stripe_subscription_id FROM billing_subscriptions WHERE stripe_subscription_id = ${quote(subscriptionId)}`,
    z.unknown(),
  ).length;
}

/** The Checkout Session ID in a Checkout page URL. */
function checkoutSessionId(url: string) {
  const id = /\/(cs_test_[A-Za-z0-9]+)/u.exec(url)?.[1];
  if (!id) throw new Error("No Checkout Session ID in the URL");
  return id;
}

const openSessionsSchema = z.object({
  data: z.array(z.object({ id: z.string(), metadata: z.record(z.string(), z.string()).nullable() })),
});

/** The open license Checkout pages of the account's customer. */
async function openLicensePages(account: Account) {
  const listed = await stripe("GET", "/v1/checkout/sessions", openSessionsSchema, {
    customer: account.customer,
    status: "open",
    limit: "100",
  });
  return listed.data.filter((session) => session.metadata?.openbot_kind === "license").map((session) => session.id);
}

async function expireCheckout(url: string) {
  await stripe("POST", `/v1/checkout/sessions/${checkoutSessionId(url)}/expire`, idSchema).catch(() => null);
}

/** The amount of the latest invoice of a subscription. */
async function latestInvoiceAmount(subscriptionId: string) {
  return (await invoices(subscriptionId))[0]?.amount ?? null;
}

/** The Price of a license plan, with its tiers or its amount in each currency. */
async function licensePrice(plan: LicensePlan): Promise<LicensePriceView> {
  const expand: Record<string, string> =
    plan.tier === "team"
      ? { "expand[0]": "tiers", "expand[1]": "currency_options.usd.tiers", "expand[2]": "currency_options.pln.tiers" }
      : { "expand[0]": "currency_options" };
  return stripe("GET", `/v1/prices/${await licensePriceId(plan)}`, licensePriceSchema, expand);
}

/**
 * True when the Price sells the plan as `stripe-bootstrap.ts` makes it: its lookup key and metadata, and
 * the amounts of `LICENSE_PLAN_PRICES`. A Team Price is graduated: the base for the included users, then
 * each extra user. A 1-user Price is a flat amount.
 */
function licensePriceMatches(price: LicensePriceView, plan: LicensePlan): boolean {
  if (
    !price.active ||
    price.lookup_key !== licenseLookupKey(plan) ||
    price.currency !== "eur" ||
    price.recurring?.interval !== plan.interval ||
    price.metadata[LICENSE_METADATA.kind] !== LICENSE_METADATA_KIND ||
    price.metadata[LICENSE_METADATA.tier] !== plan.tier ||
    price.metadata[LICENSE_METADATA.interval] !== plan.interval ||
    price.metadata[LICENSE_METADATA.bundle] !== String(plan.bundle)
  )
    return false;
  if (plan.tier !== "team")
    return BILLING_CURRENCIES.every(
      (currency) =>
        (currency === "eur" ? price.unit_amount : price.currency_options?.[currency]?.unit_amount) ===
        licensePlanPrice(plan, currency).base,
    );
  return (
    price.tiers_mode === "graduated" &&
    BILLING_CURRENCIES.every((currency) => {
      const [base, extra] = (currency === "eur" ? price.tiers : price.currency_options?.[currency]?.tiers) ?? [];
      const amounts = licensePlanPrice(plan, currency);
      return (
        base?.up_to === licenseIncludedUsers(plan.tier) &&
        base.flat_amount === amounts.base &&
        (base.unit_amount ?? 0) === 0 &&
        extra?.up_to === null &&
        extra.unit_amount === amounts.extraUser
      );
    })
  );
}

/** The Price and quantity of the license item of a subscription in Stripe. A server order also has a server item. */
async function licenseItem(subscriptionId: string) {
  const { items } = await stripe("GET", `/v1/subscriptions/${subscriptionId}`, licenseItemSchema);
  return items.data.find((item) => LICENSE_LOOKUP_KEYS.includes(item.price.lookup_key ?? "")) ?? null;
}

/** The tier and interval that D1 stores for a license. */
function licenseRow(subscriptionId: string) {
  return (
    d1(
      `SELECT tier, billing_interval FROM licenses WHERE stripe_subscription_id = ${quote(subscriptionId)}`,
      licenseRowSchema,
    )[0] ?? null
  );
}

/** The member limit that the account's host list shows for this host. */
async function hostMemberLimit(account: Account, hostId: string) {
  const listed = hostListSchema.safeParse((await account.request("GET", "v2/remote/hosts")).body).data;
  return listed?.hosts.find((host) => host.hostId === hostId)?.memberLimit ?? null;
}

/** The `legacy_member_limits` value of a hosted server row. */
function legacyMemberLimits(serverId: string) {
  return (
    d1(
      `SELECT legacy_member_limits FROM hosted_servers WHERE server_id = ${quote(serverId)}`,
      z.object({ legacy_member_limits: z.number() }),
    )[0]?.legacy_member_limits ?? null
  );
}

/** The Checkout Session of a license page, with its line and metadata. */
function licenseSession(url: string) {
  return stripe("GET", `/v1/checkout/sessions/${checkoutSessionId(url)}`, checkoutLinesSchema, {
    "expand[0]": "line_items",
    "expand[1]": "line_items.data.price",
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
      (row) => row.plan !== "standard",
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
  async refund(account) {
    // A partial refund keeps the plan. The second refund makes the payment refunded in full and ends it.
    const { server } = await account.createServer("Refund");
    const sub = await account.pay(server.serverId);
    await provisioned(account, server.serverId);
    const paid = await paymentIntent(sub);
    const sales = await recordsSales(paid.invoice);
    const partial = await stripe("POST", "/v1/refunds", refundSchema, { payment_intent: paid.intent, amount: "100" });
    await applied("refund.created", partial.id);
    const plan = await account.plan(sub);
    const row = account.row(server.serverId);
    record(
      "refund",
      "a partial refund keeps the plan and the server",
      plan?.status === "active" && row?.desired_state === "running" && row.observed_error !== "plan_ended",
      { refund: partial.status, plan, row },
    );
    const rest = await stripe("POST", "/v1/refunds", refundSchema, { payment_intent: paid.intent });
    await applied("refund.created", rest.id);
    const ended = await rowWhere(account, server.serverId, "plan ended", (row) => row.desired_state === "stopped");
    const stripeSub = await subscription(sub);
    record(
      "refund",
      "a full refund of the current invoice cancels the plan now; the server stops with plan_ended and is kept",
      stripeSub.status === "canceled" && ended.observed_error === "plan_ended" && ended.deleted_at === null,
      { refund: rest.status, stripeStatus: stripeSub.status, row: ended },
    );
    if (sales) {
      const recorded = facts(paid.invoice);
      record(
        "refund",
        "each refund is a payment_refunded sales fact",
        recorded.some((fact) => fact.source_key === `refund:${partial.id}:succeeded`) &&
          recorded.some((fact) => fact.source_key === `refund:${rest.id}:succeeded`),
        recorded,
      );
    } else {
      print("SKIP [refund] sales facts: the Worker has no OpenPanel client");
    }
    // This test card makes the refund fail after Stripe accepts it. The refund is partial, so the plan stays.
    const second = await account.createServer("Refund fails");
    await account.useCard("pm_card_refundFail");
    const secondSub = await account.pay(second.server.serverId);
    await provisioned(account, second.server.serverId);
    const secondPaid = await paymentIntent(secondSub);
    const failing = await stripe("POST", "/v1/refunds", refundSchema, {
      payment_intent: secondPaid.intent,
      amount: "100",
    });
    await applied("refund.failed", failing.id, 180_000);
    const failedRow = account.row(second.server.serverId);
    record(
      "refund",
      "a failed refund keeps the plan and the server",
      (await account.plan(secondSub))?.status === "active" && failedRow?.desired_state === "running",
      { row: failedRow },
    );
    if (sales) {
      const recorded = facts(secondPaid.invoice);
      // Stripe says this refund starts as succeeded, so both facts exist; the order of their events can vary.
      record(
        "refund",
        "a failed refund is a refund_failed fact",
        recorded.some((fact) => fact.source_key === `refund:${failing.id}:failed`),
        recorded,
      );
    }
  },

  async dispute(account) {
    const { server } = await account.createServer("Dispute");
    // This test card makes the issuer open a dispute soon after the payment.
    await account.useCard("pm_card_createDispute");
    const sub = await account.pay(server.serverId);
    const paid = await paymentIntent(sub);
    const sales = await recordsSales(paid.invoice);
    const disputed = await waitFor("dispute", async () => {
      const list = await stripe("GET", "/v1/disputes", disputeListSchema, { payment_intent: paid.intent });
      return list.data[0] ?? null;
    });
    await applied("charge.dispute.created", disputed.id);
    const ended = await rowWhere(account, server.serverId, "plan ended", (row) => row.desired_state === "stopped");
    const stripeSub = await subscription(sub);
    record(
      "dispute",
      "a dispute cancels the plan now; the server stops with plan_ended and is kept",
      stripeSub.status === "canceled" && ended.observed_error === "plan_ended" && ended.deleted_at === null,
      { dispute: disputed.status, stripeStatus: stripeSub.status, row: ended },
    );
    // This evidence text makes the test dispute close as lost.
    await stripe("POST", `/v1/disputes/${disputed.id}`, idSchema, {
      "evidence[uncategorized_text]": "losing_evidence",
      submit: "true",
    });
    await applied("charge.dispute.closed", disputed.id, 180_000);
    if (sales) {
      const recorded = facts(paid.invoice);
      record(
        "dispute",
        "the dispute and its loss are payment_disputed and dispute_lost facts",
        recorded.some((fact) => fact.source_key === `dispute:${disputed.id}:created`) &&
          recorded.some((fact) => fact.source_key === `dispute:${disputed.id}:lost`),
        recorded,
      );
    } else {
      print("SKIP [dispute] sales facts: the Worker has no OpenPanel client");
    }
  },

  // The Worker claims the welcome email before it sends it, and logs one line for each send.
  async welcome(account) {
    const since = Date.now();
    const first = await account.createServer("Welcome");
    record("welcome", "a server that is not paid gets no welcome email", welcomeClaims(account).length === 0, null);
    const sub = await account.pay(first.server.serverId);
    await applied("customer.subscription.created", sub);
    await provisioned(account, first.server.serverId);
    const claimed = await waitFor("welcome claim", async () => welcomeClaims(account)[0]);
    record(
      "welcome",
      "the first plan of the account claims the welcome email",
      claimed.type === "welcome_email",
      claimed,
    );
    const second = await account.createServer("Welcome second");
    const secondSub = await account.pay(second.server.serverId);
    await applied("customer.subscription.created", secondSub);
    await provisioned(account, second.server.serverId);
    await stripe("DELETE", `/v1/subscriptions/${sub}`, idSchema);
    await rowWhere(account, first.server.serverId, "ended", (row) => row.desired_state === "stopped");
    await account.pay(first.server.serverId);
    await rowWhere(account, first.server.serverId, "running again", (row) => row.desired_state === "running");
    if (REMOTE_D1) {
      print("SKIP [welcome] send count: the remote Worker log is not available");
      return;
    }
    const sends = await welcomeSends(account.api, since);
    record("welcome", "a second server and a renewed plan send no second welcome email", sends.length === 1, sends);
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

      // The focused page sends `focus-use-v1` pings and no input. The idle stop would come after 15 to 20 minutes.
      const web = await connectWeb(account, serverId, name, "boat-e2e-web-connected.png", 20 * 60_000);
      record(
        "boat",
        "the web client connects to the server over Signal, and the server reports the use",
        web.peers.some((peer) => peer.state === "connected") && web.activityReportedAfterMs !== null,
        web,
      );
      const reports = new Set(web.held.map((sample) => sample.lastActiveAt).filter((at) => at !== null));
      // Without focus the page sends no ping, so a failure below would not be about the server.
      record(
        "boat",
        "the held web page has focus",
        web.held.length > 0 && web.held.every((sample) => sample.focused),
        web.held,
      );
      record(
        "boat",
        "a focused web client with no input keeps the server running for 20 minutes",
        web.held.length > 0 && web.held.every((sample) => sample.desiredState === "running") && reports.size >= 3,
        { reports: reports.size, held: web.held },
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

      // A plan change: Standard (default) to Pro (large). The server stops and resumes on the new type.
      const sub = await openPlan();
      const item = (await subscription(sub)).items.data[0]?.id;
      if (!item) throw new Error("No subscription item");
      await stripe("POST", `/v1/subscriptions/${sub}`, idSchema, {
        "items[0][id]": item,
        "items[0][price]": await priceId("pro", "month"),
        proration_behavior: "always_invoice",
      });
      const resized = await runningRow("resized", (row) => row.size === "large");
      const resizedBoat = await sandbox(sandboxId);
      const resizedWeb = await connectWeb(account, serverId, name, "boat-e2e-web-after-resize.png");
      record(
        "boat",
        "Standard to Pro: the server moves to the boat large type, and the web client connects again",
        resized.plan === "pro" &&
          resizedBoat.type === "large" &&
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

  async "license-buy"(account) {
    const price = await licensePrice(TEAM_MONTH);
    record(
      "license-buy",
      "the Team monthly Price is graduated, with the base and extra-user tiers of LICENSE_PLAN_PRICES in EUR, USD and PLN",
      licensePriceMatches(price, TEAM_MONTH),
      {
        lookupKey: price.lookup_key,
        metadata: price.metadata,
        eur: price.tiers,
        usd: price.currency_options?.usd?.tiers,
        pln: price.currency_options?.pln?.tiers,
      },
    );
    const before = await account.license();
    record(
      "license-buy",
      "an account with no license sees an available license and nothing to pay",
      before.available && before.license === null && before.used === 1,
      before,
    );
    const sub = await account.buyLicense(7);
    const bought = await licenseWhere(account, "license active", (state) => state.license?.status === "active");
    record(
      "license-buy",
      "7 users in EUR: the license shows Team monthly, 7 users and the list price €100",
      bought.license?.users === 7 &&
        bought.license.currency === "eur" &&
        bought.license.amount === licensePeriodAmount(TEAM_MONTH, 7, "eur") &&
        bought.license.tier === "team" &&
        bought.license.interval === "month" &&
        bought.currency === "eur",
      bought,
    );
    record(
      "license-buy",
      "Stripe charged the tiered amount for 7 users",
      (await latestInvoiceAmount(sub)) === licensePeriodAmount(TEAM_MONTH, 7, "eur"),
      await invoices(sub),
    );
    const plans = await account.billing();
    record(
      "license-buy",
      "the server plans do not show the license, and billing_subscriptions has no license row",
      plans.length === 0 && licenseInPlans(sub) === 0,
      { plans },
    );
    record(
      "license-buy",
      "a license is not a first server plan: no welcome email",
      welcomeClaims(account).length === 0,
      {
        claims: welcomeClaims(account),
      },
    );
  },

  async "license-checkout"(account) {
    const opened = await account.request("POST", "v1/me/license/checkout", { users: 7, currency: "eur" });
    const url = licenseCheckoutSchema.safeParse(opened.body).data?.url ?? "";
    const session = url
      ? await stripe("GET", `/v1/checkout/sessions/${checkoutSessionId(url)}`, checkoutLinesSchema, {
          "expand[0]": "line_items",
          "expand[1]": "line_items.data.price",
        })
      : null;
    const line = session?.line_items.data[0];
    record(
      "license-checkout",
      "the Worker gives a checkout.stripe.com page for the license Price with quantity 7 in EUR",
      opened.status === 200 &&
        new URL(url).host === "checkout.stripe.com" &&
        line?.quantity === 7 &&
        line.price.lookup_key === licenseLookupKey(TEAM_MONTH) &&
        session?.currency === "eur",
      { status: opened.status, code: opened.code, session: session && { status: session.status, line } },
    );
    if (REAL_CHECKOUT) {
      const returned = await payCheckout(url, account.api, "license-e2e-checkout.png");
      const paid = await licenseWhere(account, "license paid", (state) => state.license?.status === "active", 120_000);
      record(
        "license-checkout",
        "the paid Checkout page makes an active license of 7 users",
        paid.license?.users === 7,
        {
          returned,
          license: paid.license,
        },
      );
    } else {
      await expireCheckout(url);
      await account.buyLicense(7);
      await licenseWhere(account, "license active", (state) => state.license?.status === "active");
    }
    const second = await account.request("POST", "v1/me/license/checkout", { users: 5, currency: "eur" });
    record("license-checkout", "a second license: 409 license_exists", second.status === 409, {
      status: second.status,
      code: second.code,
    });
    const tooMany = await account.request("POST", "v1/me/license/checkout", {
      users: LICENSE_MAX_USERS + 1,
      currency: "eur",
    });
    const tooFew = await account.request("POST", "v1/me/license/checkout", {
      users: LICENSE_INCLUDED_USERS - 1,
      currency: "eur",
    });
    record(
      "license-checkout",
      `${LICENSE_MAX_USERS + 1} or ${LICENSE_INCLUDED_USERS - 1} Team users: 400, because the app sells ${LICENSE_INCLUDED_USERS} to ${LICENSE_MAX_USERS}`,
      tooMany.status === 400 && tooFew.status === 400,
      { tooMany: tooMany.code, tooFew: tooFew.code },
    );
  },

  async "license-double-checkout"(account) {
    const body = { users: 5, currency: "eur" } as const;
    const pair = await Promise.all([
      account.request("POST", "v1/me/license/checkout", body),
      account.request("POST", "v1/me/license/checkout", body),
    ]);
    const third = await account.request("POST", "v1/me/license/checkout", body);
    const urls = [...pair, third].map((response) => licenseCheckoutSchema.safeParse(response.body).data?.url ?? "");
    const open = await openLicensePages(account);
    record(
      "license-double-checkout",
      "two requests at once and a third one leave one open license page, the page of the last response",
      [...pair, third].every((response) => response.status === 200) &&
        open.length === 1 &&
        urls[2] !== "" &&
        open[0] === checkoutSessionId(urls[2] ?? ""),
      {
        statuses: [...pair, third].map((response) => response.status),
        sameConcurrentPage: urls[0] === urls[1],
        returned: urls.map((url) => (url ? checkoutSessionId(url) : null)),
        open,
      },
    );

    // A license that Stripe has but D1 does not, as before its webhook arrives.
    const sub = await account.buyLicense(5);
    await licenseWhere(account, "license active", (state) => state.license?.status === "active");
    d1(`DELETE FROM licenses WHERE user_id = ${quote(account.id)}`, z.unknown());
    const before = d1(`SELECT stripe_subscription_id FROM licenses WHERE user_id = ${quote(account.id)}`, z.unknown());
    const refused = await account.request("POST", "v1/me/license/checkout", body);
    const after = await account.license();
    const left = await openLicensePages(account);
    record(
      "license-double-checkout",
      "a license in Stripe but not in D1: 409 license_exists, no open license page, and D1 has the license again",
      before.length === 0 &&
        refused.status === 409 &&
        refused.code === "license_exists" &&
        left.length === 0 &&
        after.license?.subscriptionId === sub,
      { rowsBefore: before.length, status: refused.status, code: refused.code, open: left, license: after.license },
    );
  },

  async "license-users"(account) {
    // 3 members on one server: the license counts 4 people with the owner. Each count stays at most
    // LICENSE_MAX_USERS (10).
    account.addServers([{ name: "Office", members: ["a", "b", "c"].map((key) => ({ key })) }]);
    const sub = await account.buyLicense(6);
    await licenseWhere(account, "license active", (state) => state.license?.users === 6);
    const invoicesBefore = (await invoices(sub)).length;
    const more = await account.request("POST", "v1/me/license/users", { users: 8 });
    const moreInvoices = await invoices(sub);
    record(
      "license-users",
      "6 → 8 users: the license shows 8, and Stripe invoices and charges the prorated amount at once",
      more.status === 200 &&
        licenseStateSchema.parse(more.body).license?.users === 8 &&
        moreInvoices.length === invoicesBefore + 1 &&
        moreInvoices[0]?.reason === "subscription_update" &&
        moreInvoices[0].status === "paid" &&
        moreInvoices[0].amount > 0,
      { status: more.status, invoices: moreInvoices },
    );
    const fewer = await account.request("POST", "v1/me/license/users", { users: 5 });
    const fewerInvoices = await invoices(sub);
    const item = await stripe(
      "GET",
      `/v1/subscriptions/${sub}`,
      z.object({ items: z.object({ data: z.array(z.object({ quantity: z.number() })) }) }),
    );
    record(
      "license-users",
      "8 → 5 users: no new invoice and no refund; the Stripe quantity is 5 for the next invoice",
      fewer.status === 200 && fewerInvoices.length === moreInvoices.length && item.items.data[0]?.quantity === 5,
      { status: fewer.status, invoices: fewerInvoices, quantity: item.items.data[0]?.quantity },
    );
    const inUse = await account.request("POST", "v1/me/license/users", { users: 3 });
    record("license-users", "3 users while 4 people use it: 409 license_users_in_use", inUse.status === 409, {
      status: inUse.status,
      code: inUse.code,
    });
    const over = await account.request("POST", "v1/me/license/users", { users: LICENSE_MAX_USERS + 1 });
    record("license-users", `${LICENSE_MAX_USERS + 1} users: 400`, over.status === 400, {
      status: over.status,
      code: over.code,
    });
    await account.useCard("pm_card_chargeCustomerFail");
    const declined = await account.request("POST", "v1/me/license/users", { users: 9 });
    const after = await account.license();
    record(
      "license-users",
      "an increase with a failing card: 402 license_payment_failed, and the license keeps 5 users",
      declined.status === 402 && declined.code === "license_payment_failed" && after.license?.users === 5,
      { status: declined.status, code: declined.code, users: after.license?.users },
    );
    await account.useCard("pm_card_visa");
    const paidBack = await account.request("POST", "v1/me/license/users", { users: 7 });
    const paidBackInvoices = await invoices(sub);
    record(
      "license-users",
      "5 → 7 users in the period that paid for 8: no new invoice",
      paidBack.status === 200 && paidBackInvoices.length === moreInvoices.length,
      { status: paidBack.status, invoices: paidBackInvoices },
    );
    const extra = await account.request("POST", "v1/me/license/users", { users: 9 });
    const extraInvoices = await invoices(sub);
    record(
      "license-users",
      "7 → 9 users: one paid invoice for the 9th user only, less than the 6 → 8 invoice",
      extra.status === 200 &&
        licenseStateSchema.parse(extra.body).license?.users === 9 &&
        extraInvoices.length === paidBackInvoices.length + 1 &&
        extraInvoices[0]?.status === "paid" &&
        extraInvoices[0].amount > 0 &&
        extraInvoices[0].amount < (moreInvoices[0]?.amount ?? 0),
      { status: extra.status, invoices: extraInvoices },
    );
  },

  async "license-limit"(account) {
    // Servers with no plan take as many active members as the license has users, so the count across
    // the owner's servers stops a join. The owner and a, b, c, lab use all 5 users.
    account.addServers([
      { name: "Office", members: [{ key: "a" }] },
      { name: "Studio", members: [{ key: "b" }, { key: "gone", active: false }] },
      { name: "Shop", members: [{ key: "c" }] },
      { name: "Lab", members: [{ key: "lab" }] },
    ]);
    await account.buyLicense(5);
    await licenseWhere(account, "license active", (state) => state.license?.users === 5 && state.used === 5);
    const refused = await account.memberJoins("new", 0);
    record(
      "license-limit",
      "5 of 5 users: a new person cannot join, 409 license_users_full",
      refused.status === 409 && refused.code === "license_users_full",
      { status: refused.status, code: refused.code },
    );
    const counted = await account.memberJoins("lab", 0);
    record("license-limit", "5 of 5 users: a member of another server of the owner joins", counted.status === 200, {
      status: counted.status,
      code: counted.code,
    });
    const [gone] = d1(
      `SELECT membership_id FROM remote_memberships
        WHERE host_id = ${quote(`e2e-${account.scenario}-1`)} AND user_id = ${quote(account.memberId("gone"))}`,
      z.object({ membership_id: z.string() }),
    );
    const reactivate = () =>
      account.request("PATCH", `v2/remote/hosts/e2e-${account.scenario}-1/members/${gone?.membership_id}`, {
        role: "member",
        reactivate: true,
      });
    const reactivated = await reactivate();
    record(
      "license-limit",
      "5 of 5 users: the owner cannot reactivate a removed member, 409 license_users_full",
      reactivated.status === 409 && reactivated.code === "license_users_full",
      { status: reactivated.status, code: reactivated.code },
    );
    const more = await account.request("POST", "v1/me/license/users", { users: 6 });
    const joined = await account.memberJoins("new", 2);
    const state = await account.license();
    record(
      "license-limit",
      "after the owner adds a user to the license, the new person joins and uses it",
      more.status === 200 && joined.status === 200 && state.used === 6,
      { users: more.status, join: joined.status, code: joined.code, used: state.used },
    );
    const again = await reactivate();
    record(
      "license-limit",
      "6 of 6 users: the reactivation is refused again",
      again.status === 409 && again.code === "license_users_full",
      { status: again.status, code: again.code },
    );
  },

  async "license-count"(account) {
    account.addServers([
      { name: "Office", members: [{ key: "shared" }, { key: "office" }, { key: "gone", active: false }] },
      { name: "Lab", members: [{ key: "shared" }, { key: "lab" }] },
    ]);
    const state = await account.license();
    const shared = state.users.find((user) => user.email === `${account.memberId("shared")}@example.com`);
    record(
      "license-count",
      "the owner plus 3 distinct active members: used is 4; a revoked member and the owner's memberships do not count",
      state.used === 4 && state.users.filter((user) => user.owner).length === 1,
      { used: state.used, users: state.users },
    );
    record(
      "license-count",
      "a member of two servers is one user with both server names",
      shared?.servers.length === 2 && shared.servers.includes("Office") && shared.servers.includes("Lab"),
      shared,
    );
    const before = await account.memberLicense("office");
    await account.buyLicense(5);
    await licenseWhere(account, "license active", (current) => current.license?.status === "active");
    const covered = await account.memberLicense("office");
    record(
      "license-count",
      "a member sees the owner's license only when it is open, and buys nothing",
      before.coveredBy.length === 0 &&
        covered.coveredBy.some((entry) => entry.ownerEmail === `${account.id}@example.com`) &&
        covered.license === null,
      { before: before.coveredBy, after: covered.coveredBy },
    );
    const revoked = await account.memberLicense("gone");
    record("license-count", "a revoked member is not covered", revoked.coveredBy.length === 0, revoked.coveredBy);
  },

  async "license-renewal"(account) {
    const sub = await account.buyLicense(5);
    await licenseWhere(account, "license active", (state) => state.license?.status === "active");
    const cancel = await account.request("POST", "v1/me/license/renewal", { cancel: true });
    const cancelled = licenseStateSchema.parse(cancel.body);
    record(
      "license-renewal",
      "cancel: the license ends at the period end, and Stripe has cancel_at_period_end",
      cancel.status === 200 &&
        cancelled.license?.cancelAtPeriodEnd === true &&
        (await subscription(sub)).cancel_at_period_end,
      cancelled.license,
    );
    const renew = await account.request("POST", "v1/me/license/renewal", { cancel: false });
    record(
      "license-renewal",
      "renew: the license continues",
      renew.status === 200 && licenseStateSchema.parse(renew.body).license?.cancelAtPeriodEnd === false,
      { status: renew.status },
    );
    await account.request("POST", "v1/me/license/renewal", { cancel: true });
    await account.advance(32);
    const ended = await licenseWhere(
      account,
      "license ended",
      (state) => state.license?.status === "canceled",
      120_000,
    );
    record(
      "license-renewal",
      "at the period end the license ends and stays in the state as ended",
      true,
      ended.license,
    );
    const again = await account.request("POST", "v1/me/license/checkout", { users: 5, currency: "eur" });
    const url = licenseCheckoutSchema.safeParse(again.body).data?.url;
    record("license-renewal", "an ended license: the account can buy a new one", again.status === 200 && Boolean(url), {
      status: again.status,
      code: again.code,
    });
    if (url) await expireCheckout(url);
    const noLicense = await account.request("POST", "v1/me/license/users", { users: 6 });
    record("license-renewal", "change users of an ended license: 404 no_license", noLicense.status === 404, {
      status: noLicense.status,
      code: noLicense.code,
    });
  },

  async "license-failed-renewal"(account) {
    const sub = await account.buyLicense(5);
    await licenseWhere(account, "license active", (state) => state.license?.status === "active");
    await account.useCard("pm_card_chargeCustomerFail");
    await account.advance(32);
    const due = await licenseWhere(account, "past_due", (state) => state.license?.status === "past_due", 120_000);
    record("license-failed-renewal", "a failed renewal shows the license as past_due", true, due.license);
    const second = await account.request("POST", "v1/me/license/checkout", { users: 5, currency: "eur" });
    record("license-failed-renewal", "a past_due license is open: no second license", second.status === 409, {
      status: second.status,
      code: second.code,
    });
    const good = await account.useCard("pm_card_visa");
    const current = await subscription(sub);
    if (!current.latest_invoice) throw new Error("No open invoice");
    await stripe("POST", `/v1/invoices/${current.latest_invoice}/pay`, idSchema, { payment_method: good });
    const recovered = await licenseWhere(account, "active again", (state) => state.license?.status === "active");
    record("license-failed-renewal", "paying the open invoice makes the license active again", true, recovered.license);
  },

  async "license-currency"(account) {
    const { server } = await account.createServer("Currency");
    const planSub = await account.pay(server.serverId);
    await planWhere(account, planSub, "plan", () => true);
    const state = await account.license();
    record(
      "license-currency",
      "an account with an EUR server plan has its license currency locked to EUR",
      state.currency === "eur",
      {
        currency: state.currency,
      },
    );
    const usd = await account.request("POST", "v1/me/license/checkout", { users: 5, currency: "usd" });
    record("license-currency", "a USD license: 409 license_currency", usd.status === 409, {
      status: usd.status,
      code: usd.code,
    });
    const eur = await account.request("POST", "v1/me/license/checkout", { users: 5, currency: "eur" });
    const url = licenseCheckoutSchema.safeParse(eur.body).data?.url;
    record("license-currency", "an EUR license gives a Checkout page", eur.status === 200 && Boolean(url), {
      status: eur.status,
    });
    if (url) await expireCheckout(url);
  },

  async "license-isolation"(account) {
    const { server } = await account.createServer("Isolation");
    const planSub = await account.pay(server.serverId);
    const row = await provisioned(account, server.serverId);
    const planBefore = await planWhere(account, planSub, "plan", () => true);
    const claims = welcomeClaims(account).length;
    const licenseSub = await account.buyLicense(7);
    await licenseWhere(account, "license active", (state) => state.license?.status === "active");
    const plans = await account.billing();
    const rowAfter = account.row(server.serverId);
    record(
      "license-isolation",
      "a license next to a server plan: the plan list, the plan and the server do not change",
      plans.length === 1 &&
        plans[0]?.subscriptionId === planSub &&
        plans[0].plan === planBefore.plan &&
        plans[0].status === planBefore.status &&
        rowAfter?.desired_state === row.desired_state &&
        rowAfter.plan === row.plan &&
        licenseInPlans(licenseSub) === 0,
      { plans, rowBefore: row, rowAfter },
    );
    record("license-isolation", "the license sends no second welcome email", welcomeClaims(account).length === claims, {
      before: claims,
      after: welcomeClaims(account).length,
    });
    await stripe("DELETE", `/v1/subscriptions/${planSub}`, idSchema);
    const ended = await rowWhere(
      account,
      server.serverId,
      "plan ended",
      (current) => current.desired_state === "stopped",
    );
    const license = await account.license();
    record(
      "license-isolation",
      "the server plan ends: the server stops with plan_ended, and the license stays active",
      ended.observed_error === "plan_ended" && license.license?.status === "active",
      { row: ended, license: license.license },
    );
    await stripe("DELETE", `/v1/subscriptions/${licenseSub}`, idSchema);
    const licenseEnded = await licenseWhere(account, "license ended", (state) => state.license?.status === "canceled");
    const stillStopped = account.row(server.serverId);
    record(
      "license-isolation",
      "the license ends: the server row does not change",
      stillStopped?.desired_state === "stopped" && stillStopped.deleted_at === null,
      { license: licenseEnded.license, row: stillStopped },
    );
  },

  async "license-prices"() {
    for (const plan of LICENSE_PLANS) {
      const price = await licensePrice(plan);
      record(
        "license-prices",
        `${licenseLookupKey(plan)}: an active Price of the ${plan.tier} tier, each ${plan.interval}, bundle ${plan.bundle}, with the amounts of LICENSE_PLAN_PRICES in EUR, USD and PLN`,
        licensePriceMatches(price, plan),
        {
          id: price.id,
          active: price.active,
          lookupKey: price.lookup_key,
          interval: price.recurring?.interval ?? null,
          metadata: price.metadata,
          unitAmount: price.unit_amount,
          tiers: price.tiers ?? null,
          currencyOptions: price.currency_options ?? null,
        },
      );
    }
    const keys = LICENSE_PLANS.map(licenseLookupKey);
    const parsed = LICENSE_LOOKUP_KEYS.map((key) => ({ key, parsed: parseBillingLookupKey(key) }));
    record(
      "license-prices",
      "the 8 license keys are the released Team monthly key and 7 new keys, and none is a server plan key",
      keys.join(",") ===
        [
          "openbot_license_starter_month",
          "openbot_license_starter_bundle_month",
          "openbot_license_starter_year",
          "openbot_license_starter_bundle_year",
          "openbot_license_month",
          "openbot_license_bundle_month",
          "openbot_license_year",
          "openbot_license_bundle_year",
        ].join(",") && parsed.every((entry) => entry.parsed === null),
      { keys, parsed },
    );
  },

  async "license-starter"(account) {
    // A server with no plan takes as many members as the license has users: here only the owner.
    account.addServers([{ name: "Solo", members: [] }]);
    const sub = await account.buyLicense(1, "eur", STARTER_MONTH);
    const bought = await licenseWhere(account, "license active", (state) => state.license?.status === "active");
    const paid = await invoices(sub);
    const amount = licensePeriodAmount(STARTER_MONTH, 1, "eur");
    record(
      "license-starter",
      "Starter in EUR: the license shows the starter tier, monthly, 1 user and €10, and Stripe charged €10",
      bought.license?.tier === "starter" &&
        bought.license.interval === "month" &&
        bought.license.users === 1 &&
        bought.license.amount === amount &&
        bought.used === 1 &&
        bought.bundle === false &&
        bought.license.bundle === false &&
        paid[0]?.amount === amount,
      {
        license: bought.license,
        used: bought.used,
        bundle: bought.bundle,
        invoices: paid,
        row: licenseRow(sub),
      },
    );
    const more = await account.request("POST", "v1/me/license/users", { users: 6 });
    const after = await account.license();
    record(
      "license-starter",
      "a Starter license cannot change its users: 409 license_one_user, and the license keeps 1 user",
      more.status === 409 && more.code === "license_one_user" && after.license?.users === 1,
      { status: more.status, code: more.code, users: after.license?.users },
    );
    const refused = await account.memberJoins("new", 0);
    const memberLimit = await hostMemberLimit(account, `e2e-${account.scenario}-0`);
    record(
      "license-starter",
      "1 of 1 users: the host list shows 1, and a member cannot join the owner's server, 409 license_users_full",
      memberLimit === 1 && refused.status === 409 && refused.code === "license_users_full",
      { memberLimit, status: refused.status, code: refused.code },
    );
  },

  async "license-bundle-align"(account) {
    const before = await account.license();
    const { server } = await account.createServer("Bundle");
    const planSub = await account.pay(server.serverId);
    await planWhere(account, planSub, "plan", () => true);
    const bundled = await licenseWhere(account, "bundle price", (state) => state.bundle === true);
    record(
      "license-bundle-align",
      "an account with no server plan has no bundle price, and a server plan gives it",
      before.bundle === false && bundled.bundle === true,
      { before: before.bundle, after: bundled.bundle },
    );
    const opened = await account.request("POST", "v1/me/license/checkout", {
      users: 1,
      currency: "eur",
      tier: "starter",
    });
    const url = licenseCheckoutSchema.safeParse(opened.body).data?.url ?? "";
    const session = url ? await licenseSession(url) : null;
    const line = session?.line_items.data[0];
    record(
      "license-bundle-align",
      "a Starter checkout gives a page for the Starter bundle Price, 1 user, with the bundle metadata",
      opened.status === 200 &&
        line?.quantity === 1 &&
        line.price.lookup_key === licenseLookupKey(STARTER_BUNDLE_MONTH) &&
        session?.metadata?.[LICENSE_METADATA.tier] === "starter" &&
        session.metadata[LICENSE_METADATA.interval] === "month" &&
        session.metadata[LICENSE_METADATA.bundle] === "true",
      { status: opened.status, code: opened.code, line, metadata: session?.metadata ?? null },
    );
    if (url) await expireCheckout(url);
    const sub = await account.buyLicense(1, "eur", STARTER_BUNDLE_MONTH);
    const bought = await licenseWhere(account, "license active", (state) => state.license?.status === "active");
    const paid = await invoices(sub);
    const bundleAmount = licensePeriodAmount(STARTER_BUNDLE_MONTH, 1, "eur");
    record(
      "license-bundle-align",
      "the license is Starter with the bundle at €8, and Stripe charged €8",
      bought.license?.tier === "starter" &&
        bought.license.bundle === true &&
        bought.license.amount === bundleAmount &&
        paid[0]?.amount === bundleAmount,
      { license: bought.license, invoices: paid },
    );

    // The server plan ends. Its sync moves the license to the Starter Price with no proration.
    await stripe("DELETE", `/v1/subscriptions/${planSub}`, idSchema);
    await rowWhere(account, server.serverId, "plan ended", (row) => row.desired_state === "stopped");
    const moved = await waitFor(
      "license on the Starter Price",
      async () => {
        const item = await licenseItem(sub);
        return item?.price.lookup_key === licenseLookupKey(STARTER_MONTH) ? item : null;
      },
      120_000,
    ).catch(() => null);
    const starter = await licenseWhere(account, "no bundle", (state) => state.license?.bundle === false, 30_000).catch(
      () => null,
    );
    const afterMove = await invoices(sub);
    const starterAmount = licensePeriodAmount(STARTER_MONTH, 1, "eur");
    record(
      "license-bundle-align",
      "the server plan ends: alignBundlePrice moves the subscription item to the Starter Price with no new invoice, and the state shows the Starter tier at €10 and no bundle",
      moved !== null &&
        starter?.license?.tier === "starter" &&
        starter.license.amount === starterAmount &&
        starter.bundle === false &&
        afterMove.length === paid.length,
      { item: moved, license: starter?.license ?? null, bundle: starter?.bundle, invoices: afterMove },
    );
    await account.advance(32);
    const renewed = await waitFor(
      "license renewal invoice",
      async () => {
        const list = await invoices(sub);
        return list.length > afterMove.length && list[0]?.status === "paid" ? list : null;
      },
      120_000,
    );
    record(
      "license-bundle-align",
      "the test clock passes the period end: the renewal invoice is the Starter price, €10",
      renewed[0]?.reason === "subscription_cycle" && renewed[0].amount === starterAmount,
      { invoices: renewed },
    );
  },

  async "order-bundle"(account) {
    if ((await account.license()).trialEnd !== undefined) {
      print("SKIP [order-bundle] the Worker sells the license promotion: start it with LICENSE_TRIAL_END=");
      return;
    }
    const team = (users: number): LicenseOrder => ({ tier: "team", users });
    const standardMembers = memberLimitForPlan("standard");
    const starterPlan = await account.orderServer("Solo server", "starter", team(LICENSE_INCLUDED_USERS));
    const tooMany = await account.orderServer("Big server", "standard", team(standardMembers + 1));
    // The message names the field, so a refused name cannot pass for a refused license.
    const licenseRefused = (response: { status: number; body: unknown }) =>
      response.status === 400 &&
      z.object({ error: z.object({ code: z.string(), message: z.string() }) }).safeParse(response.body).data?.error
        .message === "The license is invalid.";
    record(
      "order-bundle",
      `a Team license on a Starter server, and ${standardMembers + 1} Team users on a ${standardMembers}-member Standard server: 400, the license is invalid`,
      licenseRefused(starterPlan) && licenseRefused(tooMany),
      { starter: starterPlan.body, tooMany: tooMany.body },
    );

    const order = team(4);
    const opened = await account.orderServer("Order server", "standard", order);
    const created = createdSchema.safeParse(opened.body).data;
    const session = created?.checkoutUrl ? await licenseSession(created.checkoutUrl) : null;
    const lines = session?.line_items.data ?? [];
    const serverLine = lines.find((line) => line.price.lookup_key === "openbot_standard_month");
    const licenseLine = lines.find((line) => line.price.lookup_key === licenseLookupKey(TEAM_BUNDLE_MONTH));
    record(
      "order-bundle",
      "a Standard server with a Team order of 4 users: 201 and one Checkout page with 2 lines, the server Price and the Team bundle Price for 4 users",
      opened.status === 201 &&
        lines.length === 2 &&
        serverLine?.quantity === 1 &&
        licenseLine?.quantity === order.users,
      { status: opened.status, code: opened.code, lines },
    );
    if (!created) return;

    const serverId = created.server.serverId;
    const planSub = await account.payOrder(serverId, "standard", order);
    const first = await invoices(planSub);
    const serverPrice = await stripe(
      "GET",
      `/v1/prices/${await priceId("standard", "month")}`,
      z.object({ unit_amount: z.number().nullable() }),
    );
    const licenseAmount = licensePeriodAmount(TEAM_BUNDLE_MONTH, order.users, "eur");
    record(
      "order-bundle",
      "one invoice charges the server and the license together",
      first.length === 1 && first[0]?.amount === (serverPrice.unit_amount ?? 0) + licenseAmount,
      { invoices: first, serverAmount: serverPrice.unit_amount, licenseAmount },
    );

    const licensed = await licenseWhere(
      account,
      "split license active",
      (state) => state.license?.status === "active" && state.license.subscriptionId !== planSub,
      120_000,
    );
    const licenseSub = licensed.license?.subscriptionId ?? "";
    const split = await stripe(
      "GET",
      `/v1/subscriptions/${licenseSub}`,
      z.object({ metadata: z.record(z.string(), z.string()) }),
    );
    const left = await waitFor(
      "no license item on the server plan",
      async () => ((await licenseItem(planSub)) === null ? "removed" : null),
      60_000,
    ).catch(() => null);
    const splitInvoices = await invoices(licenseSub);
    record(
      "order-bundle",
      "the license moves to its own subscription: Team, 4 users, the bundle amount, the server subscription named in its metadata, no charge, and no license item on the server plan",
      licensed.license?.tier === "team" &&
        licensed.license.bundle === true &&
        licensed.license.users === order.users &&
        licensed.license.amount === licenseAmount &&
        licensed.bundle === true &&
        split.metadata[LICENSE_METADATA.orderSubscription] === planSub &&
        splitInvoices.every((invoice) => invoice.amount === 0) &&
        left !== null,
      { license: licensed.license, metadata: split.metadata, invoices: splitInvoices, removed: left },
    );
    const plan = await planWhere(account, planSub, "server plan active", (entry) => entry.status === "active");
    record(
      "order-bundle",
      "the server plan stays active and renews on the same day as the license",
      plan.plan === "standard" && plan.currentPeriodEnd === licensed.license?.currentPeriodEnd,
      { plan, license: licensed.license },
    );

    const invoice = (await subscription(planSub)).latest_invoice;
    if (invoice && (await recordsSales(invoice))) {
      const recorded = facts(invoice).map((fact) => ({ ...fact, attributes: factAttributes(fact.attributes_json) }));
      const paidFacts = recorded.filter((fact) => fact.fact_type === "payment_succeeded");
      record(
        "order-bundle",
        "the order payment gives 2 sales facts: the server and the license",
        paidFacts.some((fact) => fact.attributes?.product === "server") &&
          paidFacts.some((fact) => fact.attributes?.product === "license"),
        recorded,
      );
    } else {
      print("SKIP [order-bundle] sales facts: the Worker has no OpenPanel client");
    }

    const again = await account.orderServer("Second server", "standard", order);
    record(
      "order-bundle",
      "a second server order with a license: 409 license_exists",
      again.status === 409 && again.code === "license_exists",
      { status: again.status, code: again.code },
    );

    await account.advance(32);
    const renewed = await waitFor(
      "license renewal invoice",
      async () => {
        const list = await invoices(licenseSub);
        return list.length > splitInvoices.length && list[0]?.status === "paid" ? list : null;
      },
      120_000,
    );
    record(
      "order-bundle",
      "the test clock passes the period end: the license renews at the Team bundle amount for 4 users",
      renewed[0]?.reason === "subscription_cycle" && renewed[0].amount === licenseAmount,
      { invoices: renewed },
    );
  },

  async "license-team-year"(account) {
    const sub = await account.buyLicense(7, "eur", TEAM_YEAR);
    const bought = await licenseWhere(account, "license active", (state) => state.license?.status === "active");
    const periodEnd = bought.license?.currentPeriodEnd ?? 0;
    record(
      "license-team-year",
      "7 users yearly in EUR: the state shows Team, yearly, 7 users, a twelfth of the year as the monthly amount, and a period of about a year",
      bought.license?.tier === "team" &&
        bought.license.interval === "year" &&
        bought.license.users === 7 &&
        bought.license.amount === licenseMonthlyAmount(TEAM_YEAR, 7, "eur") &&
        periodEnd - Date.now() > 300 * DAY * 1_000,
      bought.license,
    );
    const paid = await invoices(sub);
    record(
      "license-team-year",
      "Stripe charged the yearly amount of licensePeriodAmount for 7 users",
      paid[0]?.amount === licensePeriodAmount(TEAM_YEAR, 7, "eur"),
      paid,
    );
    const row = licenseRow(sub);
    record(
      "license-team-year",
      "D1 stores the tier team and the interval year",
      row?.tier === "team" && row.billing_interval === "year",
      row,
    );
    const invoice = (await subscription(sub)).latest_invoice;
    if (invoice && (await recordsSales(invoice))) {
      const recorded = facts(invoice);
      record(
        "license-team-year",
        "the payment sales fact is a license with the interval year",
        recorded.some((fact) => {
          const attributes = factAttributes(fact.attributes_json);
          return (
            fact.fact_type === "payment_succeeded" &&
            attributes?.product === "license" &&
            attributes.interval === "year"
          );
        }),
        recorded,
      );
    } else {
      print("SKIP [license-team-year] sales facts: the Worker has no OpenPanel client");
    }
  },

  async "license-upgrade"(account) {
    const sub = await account.buyLicense(1, "eur", STARTER_MONTH);
    await licenseWhere(account, "license active", (state) => state.license?.status === "active");
    const start = await invoices(sub);
    const toMonth = await account.request("POST", "v1/me/license/plan", { interval: "month", users: 5 });
    const month = licenseStateSchema.safeParse(toMonth.body).data?.license ?? null;
    const monthItem = await licenseItem(sub);
    const monthInvoices = await invoices(sub);
    record(
      "license-upgrade",
      "Starter → Team monthly with 5 users: 200, Team monthly at €70 in the state, the Team monthly Price in Stripe, and one paid invoice now",
      toMonth.status === 200 &&
        month?.tier === "team" &&
        month.interval === "month" &&
        month.users === 5 &&
        month.amount === licensePeriodAmount(TEAM_MONTH, 5, "eur") &&
        monthItem?.price.lookup_key === licenseLookupKey(TEAM_MONTH) &&
        monthItem.quantity === 5 &&
        monthInvoices.length === start.length + 1 &&
        monthInvoices[0]?.status === "paid" &&
        monthInvoices[0].amount > 0,
      { status: toMonth.status, code: toMonth.code, license: month, item: monthItem, invoices: monthInvoices },
    );
    const toYear = await account.request("POST", "v1/me/license/plan", { interval: "year", users: 5 });
    const year = licenseStateSchema.safeParse(toYear.body).data?.license ?? null;
    const yearItem = await licenseItem(sub);
    const yearInvoices = await invoices(sub);
    const row = licenseRow(sub);
    record(
      "license-upgrade",
      "Team monthly → Team yearly: 200, Team yearly in the state and in D1, the Team yearly Price in Stripe, and one paid invoice now",
      toYear.status === 200 &&
        year?.tier === "team" &&
        year.interval === "year" &&
        year.users === 5 &&
        yearItem?.price.lookup_key === licenseLookupKey(TEAM_YEAR) &&
        yearInvoices.length === monthInvoices.length + 1 &&
        yearInvoices[0]?.status === "paid" &&
        row?.tier === "team" &&
        row.billing_interval === "year",
      { status: toYear.status, code: toYear.code, license: year, item: yearItem, invoices: yearInvoices, row },
    );
    const down = await account.request("POST", "v1/me/license/plan", { interval: "month", users: 5 });
    const after = await account.license();
    const afterItem = await licenseItem(sub);
    record(
      "license-upgrade",
      "Team yearly → Team monthly: 409 license_plan_change, and the license stays yearly",
      down.status === 409 &&
        down.code === "license_plan_change" &&
        after.license?.interval === "year" &&
        afterItem?.price.lookup_key === licenseLookupKey(TEAM_YEAR),
      { status: down.status, code: down.code, license: after.license, item: afterItem },
    );
  },

  async "license-legacy-request"(account) {
    // The body of an app from before the tiers: no tier and no interval.
    const opened = await account.request("POST", "v1/me/license/checkout", { users: 5, currency: "eur" });
    const url = licenseCheckoutSchema.safeParse(opened.body).data?.url ?? "";
    const session = url ? await licenseSession(url) : null;
    const line = session?.line_items.data[0];
    record(
      "license-legacy-request",
      "a request with only users and currency gives a page for the Team monthly Price, 5 users in EUR, with the team and month metadata",
      opened.status === 200 &&
        line?.quantity === 5 &&
        line.price.id === (await licensePriceId(TEAM_MONTH)) &&
        session?.currency === "eur" &&
        session.metadata?.[LICENSE_METADATA.tier] === "team" &&
        session.metadata[LICENSE_METADATA.interval] === "month",
      { status: opened.status, code: opened.code, line, metadata: session?.metadata ?? null },
    );
    if (REAL_CHECKOUT) {
      await payCheckout(url, account.api, "license-legacy-e2e-checkout.png");
    } else {
      await expireCheckout(url);
      await account.buyLicense(5, "eur", TEAM_MONTH);
    }
    const bought = await licenseWhere(
      account,
      "license active",
      (state) => state.license?.status === "active",
      120_000,
    );
    const sub = bought.license?.subscriptionId ?? null;
    const paid = sub ? await invoices(sub) : [];
    const amount = licensePeriodAmount(TEAM_MONTH, 5, "eur");
    record(
      "license-legacy-request",
      "the license is Team monthly with 5 users at €70, and Stripe charged €70",
      bought.license?.tier === "team" &&
        bought.license.interval === "month" &&
        bought.license.users === 5 &&
        bought.license.amount === amount &&
        paid[0]?.amount === amount,
      { license: bought.license, invoices: paid },
    );
  },

  async "license-member-limits"(account) {
    const fresh = await account.createServer("Starter now");
    const freshSub = await account.pay(fresh.server.serverId);
    // Until the webhook stores the plan, the Worker takes the first server as unpaid and reuses it.
    await planWhere(account, freshSub, "plan", () => true);
    const legacy = await account.createServer("Starter before");
    const legacySub = await account.pay(legacy.server.serverId);
    await planWhere(account, legacySub, "plan", () => true);
    const freshId = fresh.server.serverId;
    const legacyId = legacy.server.serverId;
    const written = { fresh: legacyMemberLimits(freshId), legacy: legacyMemberLimits(legacyId) };
    record(
      "license-member-limits",
      "the Worker writes legacy_member_limits = 0 for each new hosted server",
      written.fresh === 0 && written.legacy === 0,
      written,
    );
    // The migration gives 1 to each hosted server row from before it. This row stands for one of them.
    d1(`UPDATE hosted_servers SET legacy_member_limits = 1 WHERE server_id = ${quote(legacyId)}`, z.unknown());
    // Starter is sold out, so both servers pay Standard. These rows stand for Starter plans from before.
    d1(
      `UPDATE billing_subscriptions SET plan = 'starter'
       WHERE stripe_subscription_id IN (${quote(freshSub)}, ${quote(legacySub)})`,
      z.unknown(),
    );
    account.hostServer(freshId, "Starter now");
    account.hostServer(legacyId, "Starter before");

    const refused = await account.joinHost("new", freshId);
    const freshLimit = await hostMemberLimit(account, freshId);
    record(
      "license-member-limits",
      "a new Starter server allows 1 member, the owner: the host list shows 1, and a member join gives 409 member_limit_reached",
      freshLimit === 1 && refused.status === 409 && refused.code === "member_limit_reached",
      { memberLimit: freshLimit, status: refused.status, code: refused.code },
    );
    const joins = [];
    for (const key of ["a", "b", "c"]) joins.push(await account.joinHost(key, legacyId));
    const legacyLimit = await hostMemberLimit(account, legacyId);
    record(
      "license-member-limits",
      "a Starter server with legacy_member_limits = 1 allows 3 members: the host list shows 3, 2 members join next to the owner, and the third gets 409 member_limit_reached",
      legacyLimit === 3 &&
        joins[0]?.status === 200 &&
        joins[1]?.status === 200 &&
        joins[2]?.status === 409 &&
        joins[2].code === "member_limit_reached",
      { memberLimit: legacyLimit, joins: joins.map((join) => ({ status: join.status, code: join.code })) },
    );

    // Both servers go back to Standard, the plan that they pay in Stripe.
    d1(
      `UPDATE billing_subscriptions SET plan = 'standard'
       WHERE stripe_subscription_id IN (${quote(freshSub)}, ${quote(legacySub)})`,
      z.unknown(),
    );
    // New members join until the server is full, then one more: each join passes but the last.
    const fill = async (hostId: string, prefix: string, active: number, limit: number) => {
      const results = [];
      for (let index = active; index <= limit; index += 1)
        results.push(await account.joinHost(`${prefix}${index}`, hostId));
      return results;
    };
    const full = (results: { status: number; code: string | null }[]) =>
      results.slice(0, -1).every((join) => join.status === 200) &&
      results.at(-1)?.status === 409 &&
      results.at(-1)?.code === "member_limit_reached";
    const standard = memberLimitForPlan("standard");
    const freshJoins = await fill(freshId, "fresh-standard-", 1, standard);
    const freshStandardLimit = await hostMemberLimit(account, freshId);
    record(
      "license-member-limits",
      `a new Standard server allows ${standard} members: the host list shows ${standard}, ${standard - 1} members join next to the owner, and the next gets 409 member_limit_reached`,
      freshStandardLimit === standard && full(freshJoins),
      {
        memberLimit: freshStandardLimit,
        joins: freshJoins.map((join) => ({ status: join.status, code: join.code })),
      },
    );
    const legacyStandard = LEGACY_MEMBER_LIMITS.standard;
    const legacyJoins = await fill(legacyId, "legacy-standard-", LEGACY_MEMBER_LIMITS.starter, legacyStandard);
    const legacyStandardLimit = await hostMemberLimit(account, legacyId);
    record(
      "license-member-limits",
      `a Standard server with legacy_member_limits = 1 allows ${legacyStandard} members: the host list shows ${legacyStandard}, ${legacyStandard - LEGACY_MEMBER_LIMITS.starter} more members join, and the next gets 409 member_limit_reached`,
      legacyStandardLimit === legacyStandard && full(legacyJoins),
      {
        memberLimit: legacyStandardLimit,
        joins: legacyJoins.map((join) => ({ status: join.status, code: join.code })),
      },
    );
  },

  async "license-self-hosted-limit"(account) {
    account.addServers([{ name: "VPS", members: [{ key: "gone", active: false }] }]);
    const hostId = `e2e-${account.scenario}-0`;
    const outcome = (join: { status: number; code: string | null }) => ({ status: join.status, code: join.code });
    const free = [];
    for (const key of ["a", "b", "c"]) free.push(await account.memberJoins(key, 0));
    const freeLimit = await hostMemberLimit(account, hostId);
    record(
      "license-self-hosted-limit",
      `no license: the host list shows ${DEFAULT_TEAM_MEMBER_LIMIT}, 2 members join next to the owner, and the third gets 409 member_limit_reached`,
      freeLimit === DEFAULT_TEAM_MEMBER_LIMIT &&
        free[0]?.status === 200 &&
        free[1]?.status === 200 &&
        free[2]?.status === 409 &&
        free[2].code === "member_limit_reached",
      { memberLimit: freeLimit, joins: free.map(outcome) },
    );

    const sub = await account.buyLicense(5);
    await licenseWhere(account, "license active", (state) => state.license?.status === "active");
    const licensedLimit = await waitFor("host list shows the license users", async () => {
      const limit = await hostMemberLimit(account, hostId);
      return limit === 5 ? limit : null;
    });
    const licensed = [];
    for (const key of ["c", "d", "e"]) licensed.push(await account.memberJoins(key, 0));
    record(
      "license-self-hosted-limit",
      "a Team license of 5: the host list shows 5, 2 more members join, and the next gets 409 license_users_full",
      licensedLimit === 5 &&
        licensed[0]?.status === 200 &&
        licensed[1]?.status === 200 &&
        licensed[2]?.status === 409 &&
        licensed[2].code === "license_users_full",
      { memberLimit: licensedLimit, joins: licensed.map(outcome) },
    );

    const more = await account.request("POST", "v1/me/license/users", { users: 6 });
    const sixth = await account.memberJoins("e", 0);
    const sixLimit = await hostMemberLimit(account, hostId);
    record(
      "license-self-hosted-limit",
      "after the owner adds a user to the license, the host list shows 6 and one more member joins",
      more.status === 200 && sixth.status === 200 && sixLimit === 6,
      { users: more.status, join: outcome(sixth), memberLimit: sixLimit },
    );

    // A custom limit comes before the license, but the license still refuses a join after its users.
    const now = Date.now();
    d1(
      `INSERT INTO server_member_limits(server_id, owner_user_id, member_limit, created_at, updated_at)
       VALUES (${quote(hostId)}, ${quote(userId(account.scenario))}, 10, ${now}, ${now})`,
      z.unknown(),
    );
    const customLimit = await hostMemberLimit(account, hostId);
    const overCustom = await account.memberJoins("custom", 0);
    d1(`DELETE FROM server_member_limits WHERE server_id = ${quote(hostId)}`, z.unknown());
    record(
      "license-self-hosted-limit",
      "a custom limit of 10 and a license of 6 users: the host list shows 6, and a join gets 409 license_users_full",
      customLimit === 6 && overCustom.status === 409 && overCustom.code === "license_users_full",
      { memberLimit: customLimit, join: outcome(overCustom) },
    );

    // A self-hosted host can keep a plan from before the license. With no hosted row, Starter has its
    // legacy limit of 3, and the larger license gives the limit.
    const legacyPlan = `sub_e2e_${account.scenario}_legacy`;
    d1(
      `INSERT INTO billing_subscriptions(stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval,
         currency, status, current_period_end, updated_at)
       VALUES (${quote(legacyPlan)}, ${quote(userId(account.scenario))}, 'cus_e2e', ${quote(hostId)}, 'starter',
         'month', 'eur', 'active', ${now + 30 * DAY * 1_000}, ${now})`,
      z.unknown(),
    );
    const planLimit = await hostMemberLimit(account, hostId);
    const overPlan = await account.memberJoins("custom", 0);
    d1(`DELETE FROM billing_subscriptions WHERE stripe_subscription_id = ${quote(legacyPlan)}`, z.unknown());
    record(
      "license-self-hosted-limit",
      "a Starter plan from before the license (3) and a license of 6 users: the host list shows 6, and a join gets 409 license_users_full",
      planLimit === 6 && overPlan.status === 409 && overPlan.code === "license_users_full",
      { memberLimit: planLimit, join: outcome(overPlan) },
    );

    await stripe("DELETE", `/v1/subscriptions/${sub}`, idSchema);
    await licenseWhere(account, "license ended", (state) => state.license?.status === "canceled", 120_000);
    const endedLimit = await hostMemberLimit(account, hostId);
    const [counted] = d1(
      `SELECT COUNT(*) AS active FROM remote_memberships WHERE host_id = ${quote(hostId)} AND status = 'active'`,
      z.object({ active: z.number() }),
    );
    const late = await account.memberJoins("late", 0);
    const [gone] = d1(
      `SELECT membership_id FROM remote_memberships
        WHERE host_id = ${quote(hostId)} AND user_id = ${quote(account.memberId("gone"))}`,
      z.object({ membership_id: z.string() }),
    );
    const reactivated = await account.request("PATCH", `v2/remote/hosts/${hostId}/members/${gone?.membership_id}`, {
      role: "member",
      reactivate: true,
    });
    record(
      "license-self-hosted-limit",
      `the license ends: the host list shows ${DEFAULT_TEAM_MEMBER_LIMIT}, the 6 active members stay, and a join and a reactivation get 409 member_limit_reached`,
      endedLimit === DEFAULT_TEAM_MEMBER_LIMIT &&
        counted?.active === 6 &&
        late.status === 409 &&
        late.code === "member_limit_reached" &&
        reactivated.status === 409 &&
        reactivated.code === "member_limit_reached",
      { memberLimit: endedLimit, active: counted?.active, join: outcome(late), reactivation: outcome(reactivated) },
    );
  },

  async "license-trial"(account) {
    const { trialEnd } = await account.license();
    if (trialEnd === undefined) {
      print("SKIP [license-trial] the Worker sells no license promotion: set LICENSE_TRIAL_END");
      return;
    }
    const opened = await account.request("POST", "v1/me/license/checkout", {
      tier: "starter",
      interval: "month",
      users: 1,
      currency: "eur",
    });
    const url = licenseCheckoutSchema.safeParse(opened.body).data?.url ?? "";
    const session = url ? await licenseSession(url) : null;
    const line = session?.line_items.data[0];
    record(
      "license-trial",
      "the license state gives the trial end, and the Checkout page sells the Starter Price and charges 0 now",
      opened.status === 200 &&
        line?.price.lookup_key === licenseLookupKey(STARTER_MONTH) &&
        session?.amount_total === 0,
      { status: opened.status, code: opened.code, trialEnd, session },
    );
    if (REAL_CHECKOUT) {
      await payCheckout(url, account.api, "license-e2e-trial.png");
    } else {
      await expireCheckout(url);
      await account.buyLicense(1, "eur", STARTER_MONTH, trialEnd);
    }
    const trial = await licenseWhere(
      account,
      "license trialing",
      (state) => state.license?.status === "trialing",
      120_000,
    );
    const subscriptionId = trial.license?.subscriptionId ?? "";
    const charged = subscriptionId ? await invoices(subscriptionId) : [];
    record(
      "license-trial",
      "the paid page makes a trialing Starter license that ends on the trial end, with no charge",
      trial.license?.tier === "starter" &&
        trial.license.currentPeriodEnd === trialEnd &&
        trial.license.amount === licensePeriodAmount(STARTER_MONTH, 1, "eur") &&
        charged.every((invoice) => invoice.amount === 0),
      { license: trial.license, invoices: charged },
    );
  },

  async "order-trial"(account) {
    const { trialEnd } = await account.license();
    if (trialEnd === undefined) {
      print("SKIP [order-trial] the Worker sells no license promotion: set LICENSE_TRIAL_END");
      return;
    }
    const order: LicenseOrder = { tier: "team", users: 4 };
    const opened = await account.orderServer("Trial order", "standard", order);
    const created = createdSchema.safeParse(opened.body).data;
    const session = created?.checkoutUrl ? await licenseSession(created.checkoutUrl) : null;
    const lines = session?.line_items.data ?? [];
    const metadata = session?.metadata ?? {};
    record(
      "order-trial",
      "a Standard server with a Team order of 4 users: one Checkout page with the server Price only, and the order with the trial end in its metadata",
      opened.status === 201 &&
        lines.length === 1 &&
        lines[0]?.price.lookup_key === "openbot_standard_month" &&
        metadata[ORDER_METADATA.licenseTier] === "team" &&
        metadata[ORDER_METADATA.licenseUsers] === String(order.users) &&
        metadata[ORDER_METADATA.licenseInterval] === "month" &&
        metadata[ORDER_METADATA.licenseTrialEnd] === String(Math.floor(trialEnd / 1_000)),
      { status: opened.status, code: opened.code, lines, metadata },
    );
    if (!created) return;

    const planSub = await account.payOrder(created.server.serverId, "standard", order, trialEnd);
    const licensed = await licenseWhere(
      account,
      "trial license from the order",
      (state) => state.license?.status === "trialing" && state.license.subscriptionId !== planSub,
      120_000,
    );
    const licenseSub = licensed.license?.subscriptionId ?? "";
    const split = await stripe(
      "GET",
      `/v1/subscriptions/${licenseSub}`,
      z.object({ metadata: z.record(z.string(), z.string()) }),
    );
    const cleared = await waitFor(
      "no order metadata on the server plan",
      async () => {
        const server = await stripe(
          "GET",
          `/v1/subscriptions/${planSub}`,
          z.object({ metadata: z.record(z.string(), z.string()) }),
        );
        return Object.values(ORDER_METADATA).every((key) => server.metadata[key] === undefined)
          ? server.metadata
          : null;
      },
      60_000,
    ).catch(() => null);
    const charged = await invoices(licenseSub);
    record(
      "order-trial",
      "a trialing Team license of 4 users at the bundle amount starts on its own subscription, ends its trial on the trial end, names the server subscription, charges nothing, and the order metadata leaves the server plan",
      licensed.license?.tier === "team" &&
        licensed.license.bundle === true &&
        licensed.license.users === order.users &&
        licensed.license.amount === licensePeriodAmount(TEAM_BUNDLE_MONTH, order.users, "eur") &&
        licensed.license.currentPeriodEnd === trialEnd &&
        split.metadata[LICENSE_METADATA.orderSubscription] === planSub &&
        charged.every((invoice) => invoice.amount === 0) &&
        cleared !== null,
      { license: licensed.license, metadata: split.metadata, invoices: charged, serverMetadata: cleared },
    );

    const again = await account.orderServer("Second trial order", "standard", order);
    record(
      "order-trial",
      "a second server order with a license: 409 license_exists",
      again.status === 409 && again.code === "license_exists",
      { status: again.status, code: again.code },
    );
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
  const shared = await loadSharedDevelopmentEnvironment(ROOT);
  for (const [name, value] of Object.entries(shared)) {
    if (process.env[name] === undefined) process.env[name] = value;
  }
  if (!/^(sk|rk)_test_/u.test(process.env.STRIPE_SECRET_KEY ?? ""))
    throw new Error("STRIPE_SECRET_KEY must be a test-mode key.");
  const api = args[args.indexOf("--api") + 1];
  if (!args.includes("--api") || !api) throw new Error("Pass --api <Worker origin>.");
  const chosen = SCENARIOS.filter((scenario) => args.includes(scenario));
  // A real VM costs money, so `boat` runs only when named.
  const run = chosen.length > 0 ? chosen : SCENARIOS.filter((scenario) => scenario !== "boat");
  if (run.includes("boat") && !process.env.BOAT_API_KEY?.trim())
    throw new Error("BOAT_API_KEY is required for the boat scenario.");
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
