import {
  BILLING_CURRENCIES,
  BILLING_INTERVALS,
  BILLING_METADATA,
  BILLING_PLAN_IDS,
  BILLING_PLANS,
  BILLING_SUBSCRIPTION_STATUSES,
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
  type BillingPortalRequest,
  type BillingServerPlan,
  type BillingState,
  type BillingSubscriptionStatus,
  billingLookupKey,
  isBillingAmount,
  isOpenBillingStatus,
  parseBillingLookupKey,
} from "@openbot/contracts/billing";
import type { HostedServerCatalog, HostedServerCatalogPlan } from "@openbot/contracts/hosted-servers";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { type AccountAnalytics, type BillingAction, NO_ACCOUNT_ANALYTICS } from "./account-analytics";
import {
  isBillingCurrency,
  parseStripeEvent,
  StripeClient,
  type StripeEvent,
  type StripeFetch,
  type StripePrice,
  StripeRequestError,
  type StripeSubscription,
  subscriptionAmount,
  subscriptionCustomerId,
  subscriptionPeriodEnd,
  verifyStripeSignature,
} from "./stripe-client";

/** Stripe retries a webhook for up to 3 days, so older event ids are not needed to stop duplicates. */
const WEBHOOK_EVENT_RETENTION_MS = 7 * 24 * 60 * 60_000;
export const OPEN_STATUSES_SQL = "('active', 'trialing', 'past_due', 'unpaid', 'paused')";
/** The Remote host id shape (`requiredIdentifier` in remote-control-plane.ts). Other values are stored as no server. */
const SERVER_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/u;
const LAPSED_PLAN_GRACE_MS = 24 * 60 * 60 * 1000;
const LAPSED_PLAN_READ_INTERVAL_MS = 60 * 60 * 1000;
const LAPSED_PLAN_BATCH_SIZE = 20;
/** Prices change only when `stripe-bootstrap.ts` runs, so each isolate reads them once in this time. */
const CATALOG_TTL_MS = 5 * 60_000;
const catalogCache = new Map<string, { expiresAt: number; prices: ReadonlyMap<string, StripePrice> }>();

/** Where the Stripe page sends the user back: the desktop return page or the web client. */
export type BillingReturnTarget = "desktop" | "web";

export class BillingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const BILLING_UNAVAILABLE_STATE: BillingState = { available: false, hasCustomer: false, servers: [] };

interface ServerPlanRow {
  stripe_subscription_id: string;
  server_id: string | null;
  server_name: string | null;
  plan: string;
  interval: string;
  currency: string;
  amount: number | null;
  status: string;
  current_period_end: number | null;
  cancel_at_period_end: number;
}

/** A subscription that the webhook stored, for a server that its metadata names. */
export interface SubscriptionSync {
  subscriptionId: string;
  userId: string;
  serverId: string;
  status: BillingSubscriptionStatus;
  /** The plan of the subscription now. A Customer Portal change can move it to another plan or interval. */
  plan: BillingPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
}

export interface BillingServiceOptions {
  database: D1Database;
  secretKey: string;
  webhookSecret: string | null;
  fetch: StripeFetch;
  now?: () => number;
  /**
   * Runs after the webhook stores a subscription. Hosted servers use it to start or stop a server, so
   * billing does not know about the provider. An error makes Stripe send the event again.
   */
  onSubscriptionSynced?: (sync: SubscriptionSync) => Promise<void>;
  analytics?: AccountAnalytics;
}

/** The stored state of a subscription before a sync, to find the change that the sync made. */
interface StoredSubscription {
  status: string;
  plan: string;
  interval: string;
  cancel_at_period_end: number;
}

/** A subscription that a webhook stored, with its account. */
interface SyncedSubscription {
  userId: string;
  plan: BillingPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
}

export interface CheckoutRequest {
  user: { id: string; email: string };
  serverId: string;
  plan: BillingPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
  target: BillingReturnTarget;
  origin: string;
}

export class BillingService {
  readonly #database: D1Database;
  readonly #stripe: StripeClient;
  readonly #secretKey: string;
  readonly #webhookSecret: string | null;
  readonly #now: () => number;
  readonly #onSubscriptionSynced: ((sync: SubscriptionSync) => Promise<void>) | null;
  readonly #analytics: AccountAnalytics;

  constructor(options: BillingServiceOptions) {
    this.#database = options.database;
    this.#stripe = new StripeClient(options.secretKey, options.fetch);
    this.#secretKey = options.secretKey;
    this.#webhookSecret = options.webhookSecret;
    this.#now = options.now ?? Date.now;
    this.#onSubscriptionSynced = options.onSubscriptionSynced ?? null;
    this.#analytics = options.analytics ?? NO_ACCOUNT_ANALYTICS;
  }

  /** The plans with their Stripe prices. A plan with no price in each currency and interval is left out. */
  async catalog(): Promise<HostedServerCatalog> {
    const prices = await this.#prices();
    const plans = BILLING_PLANS.flatMap((plan): HostedServerCatalogPlan[] => {
      const amounts: Partial<HostedServerCatalogPlan["prices"]> = {};
      for (const currency of BILLING_CURRENCIES) {
        const month = priceAmount(prices.get(billingLookupKey(plan.id, "month")), currency);
        const year = priceAmount(prices.get(billingLookupKey(plan.id, "year")), currency);
        if (month === null || year === null) return [];
        amounts[currency] = { month, year };
      }
      const { eur, usd, pln } = amounts;
      if (!eur || !usd || !pln) return [];
      const entry = {
        id: plan.id,
        diskGb: plan.storageGb,
        memberLimit: plan.memberLimit,
        relativeSpeed: plan.relativeSpeed,
        prices: { eur, usd, pln },
      };
      return [entry];
    });
    if (plans.length === 0) throw plansUnavailable();
    return { plans };
  }

  /**
   * The Stripe customer of the account. The service makes it before the first Checkout, so two open
   * Checkouts use one customer and the webhook always knows the account.
   */
  async ensureCustomer(user: { id: string; email: string }): Promise<string> {
    const existing = await this.#customerId(user.id);
    // A customer deleted in the Stripe Dashboard cannot pay, so the account gets a new one.
    if (existing && !(await this.#stripeCall(() => this.#stripe.isCustomerDeleted(existing)))) return existing;
    const created = await this.#stripeCall(() =>
      this.#stripe.createCustomer(
        { userId: user.id, email: user.email },
        existing ? `openbot-customer-${user.id}-after-${existing}` : `openbot-customer-${user.id}`,
      ),
    );
    const now = this.#now();
    const store = existing
      ? this.#database
          .prepare(
            "UPDATE billing_customers SET stripe_customer_id = ?, updated_at = ? WHERE user_id = ? AND stripe_customer_id = ?",
          )
          .bind(created, now, user.id, existing)
      : this.#database
          .prepare(
            `INSERT INTO billing_customers(user_id, stripe_customer_id, created_at, updated_at)
             VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          )
          .bind(user.id, created, now, now);
    await store.run();
    const stored = await this.#customerId(user.id);
    if (!stored) throw new BillingError(500, "billing_customer_failed", "The billing account could not be saved.");
    return stored;
  }

  /** A Stripe Checkout page that starts the plan of one server. */
  async createCheckout(request: CheckoutRequest): Promise<{ sessionId: string; url: string }> {
    const price = (await this.#prices()).get(billingLookupKey(request.plan, request.interval));
    const amount = priceAmount(price, request.currency);
    if (!price || amount === null) throw plansUnavailable();
    const customerId = await this.ensureCustomer(request.user);
    const returnUrl = checkoutReturnUrl(request.origin, request.target, request.serverId);
    const session = await this.#stripeCall(() =>
      this.#stripe.createCheckoutSession({
        customerId,
        priceId: price.id,
        currency: request.currency,
        userId: request.user.id,
        serverId: request.serverId,
        successUrl: returnUrl,
        cancelUrl: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}cancelled=1`,
        nowSeconds: Math.floor(this.#now() / 1_000),
      }),
    );
    this.#analytics.track(request.user.id, {
      name: "billing_action",
      action: "checkout_started",
      plan: request.plan,
      interval: request.interval,
      currency: request.currency,
      amount,
    });
    return { sessionId: session.id, url: session.url };
  }

  /**
   * Closes a Checkout page. `paid` when the user paid on it, so no second page must open. The plan of a
   * paid page is stored now: its webhook can be late, or can fail each time.
   */
  async closeCheckout(sessionId: string): Promise<"closed" | "paid"> {
    const session = await this.#stripeCall(() => this.#stripe.expireCheckoutSession(sessionId));
    if (session.status !== "complete") return "closed";
    const subscriptionId = session.subscription;
    if (subscriptionId) {
      // The webhook or the next close stores it. A Stripe failure is logged by `#stripeCall`.
      await this.#syncSubscription(subscriptionId).catch(() => {
        console.warn("billing: paid Checkout sync failed", { subscriptionId });
      });
    }
    return "paid";
  }

  /**
   * Reads again each open plan whose period ended a day ago. Stripe moves the period end at each renewal,
   * so such a plan missed a webhook, for example a cancel while the webhook failed for 3 days.
   * Each plan is read at most once per hour.
   */
  async refreshLapsedPlans(now: number): Promise<void> {
    const rows = await this.#database
      .prepare(
        `SELECT stripe_subscription_id FROM billing_subscriptions
         WHERE status IN ${OPEN_STATUSES_SQL} AND current_period_end < ? AND updated_at < ?
         ORDER BY updated_at LIMIT ?`,
      )
      .bind(now - LAPSED_PLAN_GRACE_MS, now - LAPSED_PLAN_READ_INTERVAL_MS, LAPSED_PLAN_BATCH_SIZE)
      .all<{ stripe_subscription_id: string }>();
    for (const row of rows.results) {
      await this.#syncSubscription(row.stripe_subscription_id).catch(() => {
        console.warn("billing: lapsed plan sync failed", { subscriptionId: row.stripe_subscription_id });
      });
    }
  }

  /**
   * Cancels each open plan of one server now, with no refund. It stops at the first plan that Stripe
   * did not cancel, so the caller can keep the server.
   */
  async cancelServerPlans(userId: string, serverId: string): Promise<void> {
    const rows = await this.#database
      .prepare(
        `SELECT stripe_subscription_id FROM billing_subscriptions
         WHERE user_id = ? AND server_id = ? AND status IN ${OPEN_STATUSES_SQL}`,
      )
      .bind(userId, serverId)
      .all<{ stripe_subscription_id: string }>();
    for (const row of rows.results) await this.cancelSubscription(row.stripe_subscription_id);
  }

  /** Cancels one subscription now. A subscription that Stripe closed already counts as cancelled. */
  async cancelSubscription(subscriptionId: string): Promise<void> {
    const stored = await this.#database
      .prepare(
        `SELECT user_id, plan, interval, currency, amount, status FROM billing_subscriptions
         WHERE stripe_subscription_id = ?`,
      )
      .bind(subscriptionId)
      .first<{
        user_id: string;
        plan: string;
        interval: string;
        currency: string;
        amount: number | null;
        status: string;
      }>();
    await this.#stripeCall(async () => {
      try {
        await this.#stripe.cancelSubscription(subscriptionId);
      } catch (error) {
        if (!(error instanceof StripeRequestError)) throw error;
        const current = await this.#stripe.getSubscription(subscriptionId);
        if (current.status !== "canceled" && current.status !== "incomplete_expired") throw error;
      }
    });
    // The webhook stores the final state later. Until then the plan must not count as open.
    await this.#database
      .prepare(
        `UPDATE billing_subscriptions SET status = 'canceled', cancel_at_period_end = 0, updated_at = ?
         WHERE stripe_subscription_id = ?`,
      )
      .bind(this.#now(), subscriptionId)
      .run();
    // The webhook that follows sees the plan closed already, so the end is reported here.
    if (stored && isOneOf(BILLING_SUBSCRIPTION_STATUSES, stored.status) && isOpenBillingStatus(stored.status)) {
      this.#analytics.track(stored.user_id, {
        name: "billing_action",
        action: "plan_ended",
        ...(isOneOf(BILLING_PLAN_IDS, stored.plan) ? { plan: stored.plan } : {}),
        ...(isOneOf(BILLING_INTERVALS, stored.interval) ? { interval: stored.interval } : {}),
        ...(isBillingCurrency(stored.currency) ? { currency: stored.currency } : {}),
        amount: stored.amount,
      });
    }
  }

  /** The open plan of each server. The server name comes only from a host that the same account owns. */
  async getState(userId: string): Promise<BillingState> {
    const [customer, rows] = await Promise.all([
      this.#customerId(userId),
      this.#database
        .prepare(
          `SELECT s.stripe_subscription_id, s.server_id, h.name AS server_name, s.plan, s.interval, s.currency,
                  s.amount, s.status, s.current_period_end, s.cancel_at_period_end
           FROM billing_subscriptions s
           LEFT JOIN remote_hosts h ON h.host_id = s.server_id AND h.owner_user_id = s.user_id
           WHERE s.user_id = ? AND s.status IN ${OPEN_STATUSES_SQL}
           ORDER BY h.name IS NULL, h.name COLLATE NOCASE, s.updated_at DESC`,
        )
        .bind(userId)
        .all<ServerPlanRow>(),
    ]);
    const servers = rows.results.flatMap((row) => {
      const server = serverPlan(row);
      return server ? [server] : [];
    });
    return { available: true, hasCustomer: customer !== null, servers };
  }

  /**
   * Returns a Customer Portal page. The plan change and cancel flows open on one subscription, after
   * the service checks that the subscription belongs to the account.
   */
  async createPortal(
    userId: string,
    request: BillingPortalRequest,
    target: BillingReturnTarget,
    origin: string,
  ): Promise<string> {
    const customerId = await this.#customerId(userId);
    if (!customerId) throw new BillingError(404, "no_customer", "No billing account exists yet.");
    const returnUrl = portalReturnUrl(origin, target);
    this.#analytics.track(userId, { name: "billing_action", action: "portal_opened", flow: request.flow });
    if (request.flow === "manage") {
      return this.#stripeCall(() => this.#stripe.createPortalSession({ customerId, returnUrl }));
    }
    const owned = await this.#database
      .prepare(
        `SELECT 1 AS owned FROM billing_subscriptions
         WHERE stripe_subscription_id = ? AND user_id = ? AND stripe_customer_id = ? AND status IN ${OPEN_STATUSES_SQL}`,
      )
      .bind(request.subscriptionId, userId, customerId)
      .first<{ owned: number }>();
    if (!owned) throw new BillingError(404, "no_subscription", "This plan does not exist.");
    const type = request.flow === "update" ? "subscription_update" : "subscription_cancel";
    return this.#stripeCall(() =>
      this.#stripe.createPortalSession({
        customerId,
        returnUrl,
        flow: { type, subscriptionId: request.subscriptionId },
      }),
    );
  }

  /**
   * Applies one Stripe event. Each event gets the subscription from Stripe again, so a late or repeated
   * event cannot write an old state. An error makes the route answer 500, so Stripe sends the event again.
   */
  async handleWebhook(payload: string, signature: string | null): Promise<void> {
    if (!this.#webhookSecret) throw new BillingError(503, "billing_unavailable", "Billing is not available.");
    const now = this.#now();
    if (!(await verifyStripeSignature(payload, signature, this.#webhookSecret, now))) {
      throw new BillingError(400, "invalid_signature", "The Stripe signature is invalid.");
    }
    const event = parseStripeEvent(payload);
    if (!event) throw new BillingError(400, "invalid_event", "The Stripe event is invalid.");
    const seen = await this.#database
      .prepare("SELECT 1 AS seen FROM billing_webhook_events WHERE event_id = ?")
      .bind(event.id)
      .first<{ seen: number }>();
    if (seen) return;
    const subscriptionId = eventSubscriptionId(event);
    const synced = subscriptionId ? await this.#syncSubscription(subscriptionId) : null;
    // The event is recorded only after it is applied, so a failed event is applied again on retry.
    await this.#database.batch([
      this.#database
        .prepare("INSERT OR IGNORE INTO billing_webhook_events(event_id, type, received_at) VALUES (?, ?, ?)")
        .bind(event.id, event.type, now),
      this.#database
        .prepare("DELETE FROM billing_webhook_events WHERE received_at < ?")
        .bind(now - WEBHOOK_EVENT_RETENTION_MS),
    ]);
    await this.#trackEvent(event, synced);
  }

  /** Reports a payment or an expired Checkout. A change of the plan itself is reported by the sync. */
  async #trackEvent(event: StripeEvent, synced: SyncedSubscription | null): Promise<void> {
    const object = event.data.object;
    if (event.type === "checkout.session.expired") {
      const userId = isDynamicRecord(object.metadata) ? object.metadata[BILLING_METADATA.userId] : null;
      const user = isString(userId)
        ? await this.#database.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first<{ id: string }>()
        : null;
      if (user) this.#analytics.track(user.id, { name: "billing_action", action: "checkout_expired" });
      return;
    }
    if (!synced || (event.type !== "invoice.paid" && event.type !== "invoice.payment_failed")) return;
    const paid = event.type === "invoice.paid";
    const amount = paid ? object.amount_paid : object.amount_due;
    const currency = isString(object.currency) ? object.currency.toLowerCase() : null;
    this.#analytics.track(synced.userId, {
      name: "billing_action",
      action: paid ? "payment_succeeded" : "payment_failed",
      plan: synced.plan,
      interval: synced.interval,
      currency: synced.currency,
      amount: currency === synced.currency && isBillingAmount(amount) ? amount : null,
    });
  }

  async #syncSubscription(subscriptionId: string): Promise<SyncedSubscription | null> {
    // The time of the read, not of the write: a read that started later holds the newer state.
    const readAt = this.#now();
    const subscription = await this.#stripeCall(() => this.#stripe.getSubscription(subscriptionId));
    const customerId = subscriptionCustomerId(subscription);
    const price = subscription.items.data[0]?.price;
    // A changed amount moves the lookup key to a new Price, and current subscriptions keep the old one.
    const key =
      parseBillingLookupKey(price?.lookup_key) ??
      parseBillingLookupKey(`openbot_${price?.metadata.openbot_plan}_${price?.metadata.openbot_interval}`);
    const currency = subscription.currency.toLowerCase();
    if (!key || !isBillingCurrency(currency) || !isOneOf(BILLING_SUBSCRIPTION_STATUSES, subscription.status)) {
      console.warn("billing: subscription is not an OpenBot plan", { subscriptionId });
      return null;
    }
    const ownerId = await this.#subscriptionOwner(subscription, customerId);
    if (!ownerId) return null;
    const metadataServerId = subscription.metadata[BILLING_METADATA.serverId];
    const serverId = metadataServerId && SERVER_ID_PATTERN.test(metadataServerId) ? metadataServerId : null;
    const previous = await this.#database
      .prepare(
        "SELECT status, plan, interval, cancel_at_period_end FROM billing_subscriptions WHERE stripe_subscription_id = ?",
      )
      .bind(subscription.id)
      .first<StoredSubscription>();
    const cancelAtPeriodEnd = subscription.cancel_at_period_end || typeof subscription.cancel_at === "number";
    const amount = subscriptionAmount(subscription);
    // Two events for one subscription can run at the same time. The write of the older read is skipped.
    const stored = await this.#database
      .prepare(
        `INSERT INTO billing_subscriptions(
           stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, amount,
           status, current_period_end, cancel_at_period_end, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(stripe_subscription_id) DO UPDATE SET
           server_id = excluded.server_id,
           plan = excluded.plan,
           interval = excluded.interval,
           currency = excluded.currency,
           amount = excluded.amount,
           status = excluded.status,
           current_period_end = excluded.current_period_end,
           cancel_at_period_end = excluded.cancel_at_period_end,
           updated_at = excluded.updated_at
         WHERE excluded.updated_at >= billing_subscriptions.updated_at`,
      )
      .bind(
        subscription.id,
        ownerId,
        customerId,
        serverId,
        key.plan,
        key.interval,
        currency,
        amount,
        subscription.status,
        subscriptionPeriodEnd(subscription),
        cancelAtPeriodEnd ? 1 : 0,
        readAt,
      )
      .run();
    const synced: SyncedSubscription = { userId: ownerId, plan: key.plan, interval: key.interval, currency };
    if (stored.meta.changes !== 1) return synced;
    this.#trackChange(previous, { ...synced, amount, status: subscription.status, cancelAtPeriodEnd });
    if (serverId && this.#onSubscriptionSynced) {
      await this.#onSubscriptionSynced({
        subscriptionId,
        userId: ownerId,
        serverId,
        status: subscription.status,
        plan: key.plan,
        interval: key.interval,
        currency,
      });
    }
    return synced;
  }

  /** Reports the change of a plan that one sync made. A sync that changes nothing reports nothing. */
  #trackChange(
    previous: StoredSubscription | null,
    current: SyncedSubscription & {
      amount: number | null;
      status: BillingSubscriptionStatus;
      cancelAtPeriodEnd: boolean;
    },
  ): void {
    const action = planChange(previous, current);
    if (!action) return;
    this.#analytics.track(current.userId, {
      name: "billing_action",
      action,
      plan: current.plan,
      interval: current.interval,
      currency: current.currency,
      amount: current.amount,
    });
  }

  async #prices(): Promise<ReadonlyMap<string, StripePrice>> {
    const cached = catalogCache.get(this.#secretKey);
    const now = this.#now();
    if (cached && cached.expiresAt > now) return cached.prices;
    const lookupKeys = BILLING_PLAN_IDS.flatMap((plan) =>
      BILLING_INTERVALS.map((interval) => billingLookupKey(plan, interval)),
    );
    const list = await this.#stripeCall(() => this.#stripe.listPricesByLookupKeys(lookupKeys));
    const prices = new Map(list.flatMap((price) => (price.lookup_key ? [[price.lookup_key, price] as const] : [])));
    catalogCache.set(this.#secretKey, { expiresAt: now + CATALOG_TTL_MS, prices });
    return prices;
  }

  /**
   * The account of a subscription. A known customer names it. For a new customer, the subscription
   * metadata names the account, and the service links the customer to it. The service never moves a
   * customer or an account to a second link.
   */
  async #subscriptionOwner(subscription: StripeSubscription, customerId: string): Promise<string | null> {
    // A stored subscription keeps its account, also after the account gets a new customer.
    const stored = await this.#database
      .prepare("SELECT user_id FROM billing_subscriptions WHERE stripe_subscription_id = ?")
      .bind(subscription.id)
      .first<{ user_id: string }>();
    if (stored) return stored.user_id;
    const known = await this.#database
      .prepare("SELECT user_id FROM billing_customers WHERE stripe_customer_id = ?")
      .bind(customerId)
      .first<{ user_id: string }>();
    if (known) return known.user_id;
    const userId = subscription.metadata[BILLING_METADATA.userId];
    const user = userId
      ? await this.#database.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first<{ id: string }>()
      : null;
    if (!user) {
      console.warn("billing: subscription names no OpenBot account", { subscriptionId: subscription.id });
      return null;
    }
    const now = this.#now();
    await this.#database
      .prepare(
        `INSERT INTO billing_customers(user_id, stripe_customer_id, created_at, updated_at)
         VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .bind(user.id, customerId, now, now)
      .run();
    if ((await this.#customerId(user.id)) === customerId) return user.id;
    console.warn("billing: account already has another Stripe customer", { subscriptionId: subscription.id });
    return null;
  }

  async #customerId(userId: string): Promise<string | null> {
    const row = await this.#database
      .prepare("SELECT stripe_customer_id FROM billing_customers WHERE user_id = ?")
      .bind(userId)
      .first<{ stripe_customer_id: string }>();
    return row?.stripe_customer_id ?? null;
  }

  async #stripeCall<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof StripeRequestError)) throw error;
      // The error message holds only Stripe's error type and code.
      console.error("billing: Stripe request failed", error.message);
      throw new BillingError(
        502,
        "payment_service_failed",
        "The payment service could not complete the request. Try again later.",
      );
    }
  }
}

function planChange(
  previous: StoredSubscription | null,
  current: {
    plan: BillingPlanId;
    interval: BillingInterval;
    status: BillingSubscriptionStatus;
    cancelAtPeriodEnd: boolean;
  },
): BillingAction | null {
  const wasOpen =
    previous !== null &&
    isOneOf(BILLING_SUBSCRIPTION_STATUSES, previous.status) &&
    isOpenBillingStatus(previous.status);
  const isOpen = isOpenBillingStatus(current.status);
  if (!previous || !wasOpen) return isOpen ? "plan_started" : null;
  if (!isOpen) return "plan_ended";
  if (previous.plan !== current.plan || previous.interval !== current.interval) return "plan_changed";
  const wasCancelling = previous.cancel_at_period_end === 1;
  if (wasCancelling === current.cancelAtPeriodEnd) return null;
  return current.cancelAtPeriodEnd ? "cancel_scheduled" : "cancel_withdrawn";
}

function serverPlan(row: ServerPlanRow): BillingServerPlan | null {
  if (
    !isOneOf(BILLING_PLAN_IDS, row.plan) ||
    !isOneOf(BILLING_INTERVALS, row.interval) ||
    !isBillingCurrency(row.currency) ||
    !(row.amount === null || isBillingAmount(row.amount)) ||
    !isOneOf(BILLING_SUBSCRIPTION_STATUSES, row.status)
  ) {
    return null;
  }
  return {
    subscriptionId: row.stripe_subscription_id,
    serverId: row.server_id,
    serverName: row.server_name,
    plan: row.plan,
    interval: row.interval,
    currency: row.currency,
    amount: row.amount,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end === 1,
  };
}

/** The amount of one period in `currency`: the base amount, or the amount in `currency_options`. */
function priceAmount(price: StripePrice | undefined, currency: BillingCurrency): number | null {
  if (!price) return null;
  const amount = price.currency === currency ? price.unit_amount : price.currency_options?.[currency]?.unit_amount;
  return isBillingAmount(amount) ? amount : null;
}

function plansUnavailable(): BillingError {
  return new BillingError(503, "plans_unavailable", "The plans are not available. Try again later.");
}

/** The web client opens the progress of this server again. The desktop app polls, so its page only says to go back. */
function checkoutReturnUrl(origin: string, target: BillingReturnTarget, serverId: string): string {
  if (target === "web") return `${origin}/app?hosting=checkout&hosted_server=${encodeURIComponent(serverId)}`;
  return `${origin}/billing/return`;
}

function portalReturnUrl(origin: string, target: BillingReturnTarget): string {
  if (target === "web") return `${origin}/app?billing=portal`;
  return `${origin}/billing/return`;
}

/** The subscription that an event is about, or null for an event that does not change one. */
function eventSubscriptionId(event: StripeEvent): string | null {
  const object = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
      return object.mode === "subscription" && isString(object.subscription) ? object.subscription : null;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
    case "customer.subscription.pending_update_applied":
    case "customer.subscription.pending_update_expired":
      return isString(object.id) ? object.id : null;
    case "invoice.paid":
    case "invoice.payment_failed": {
      if (isString(object.subscription)) return object.subscription;
      // From API version 2025-03-31 the invoice names its subscription under `parent`.
      const details = isDynamicRecord(object.parent) ? object.parent.subscription_details : null;
      return isDynamicRecord(details) && isString(details.subscription) ? details.subscription : null;
    }
    default:
      return null;
  }
}
