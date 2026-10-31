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
import type {
  HostedServerCatalog,
  HostedServerCatalogPlan,
  HostedServerEntryPoint,
} from "@openbot/contracts/hosted-servers";
import {
  LICENSE_METADATA,
  LICENSE_METADATA_KIND,
  type LicenseOrder,
  licensePeriodAmount,
  ORDER_METADATA,
  parseLicenseOrder,
} from "@openbot/contracts/license";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Context, Effect, Layer } from "effect";
import { SOLD_OUT_PLANS } from "../lib/pricing-page";
import {
  type AccountAnalytics,
  type BillingAction,
  NO_ACCOUNT_ANALYTICS,
  type PlanChangeDirection,
  type PlanEndReason,
} from "./account-analytics";
import {
  BillingError,
  BillingOperationError,
  billingCall,
  OPEN_STATUSES_SQL,
  stripeFailure,
  stripeRequest,
} from "./billing-errors";
import { type BillingSales, type BillingSalesSynced, type PaymentReversal, paymentReversal } from "./billing-sales";
import type { HostedFailure } from "./hosted-server-service";
import { LicenseService, type LicenseSync, ordersLicense } from "./license-service";
import type { RemoteFailure } from "./remote-control-plane";
import type { StripeTransportError } from "./stripe-client";
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
  subscriptionLatestInvoiceId,
  subscriptionLicenseItem,
  subscriptionPeriodEnd,
  subscriptionServerItem,
  verifyStripeSignature,
} from "./stripe-client";

/** Stripe retries a webhook for up to 3 days, so older event ids are not needed to stop duplicates. */
const WEBHOOK_EVENT_RETENTION_MS = 7 * 24 * 60 * 60_000;
/** The key of an account's welcome email claim in `billing_webhook_events`. No Stripe event id has it. */
const WELCOME_EMAIL_CLAIM_PREFIX = "openbot_welcome_email:";
/** The Remote host id shape (`requiredIdentifier` in remote-control-plane.ts). Other values are stored as no server. */
const SERVER_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/u;
const LAPSED_PLAN_GRACE_MS = 24 * 60 * 60 * 1000;
const LAPSED_PLAN_READ_INTERVAL_MS = 60 * 60 * 1000;
const LAPSED_PLAN_BATCH_SIZE = 20;
/** Prices change only when `stripe-bootstrap.ts` runs, so each isolate reads them once in this time. */
const CATALOG_TTL_MS = 5 * 60_000;
const catalogCache = new Map<string, { expiresAt: number; prices: ReadonlyMap<string, StripePrice> }>();

export { BillingError } from "./billing-errors";

/** Where the Stripe page sends the user back: the desktop return page or the web client. */
export type BillingReturnTarget = "desktop" | "web";

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
  /** A license bought before this time is free until then, in milliseconds since the epoch. */
  licenseTrialEnd?: number | null;
  fetch: StripeFetch;
  now?: () => number;
  /**
   * Runs after the webhook stores a subscription. Hosted servers use it to start or stop a server, so
   * billing does not know about the provider. An error makes Stripe send the event again.
   */
  onSubscriptionSynced?: (sync: SubscriptionSync) => Effect.Effect<void, HostedFailure | RemoteFailure>;
  /** Runs after the webhook stores a license change that can change the member limit of the owner's servers. */
  onLicenseChanged?: (userId: string) => Effect.Effect<void, RemoteFailure>;
  analytics?: AccountAnalytics;
  sales?: BillingSales;
  /**
   * Runs once for an account, when its first plan starts. It must not throw or wait: the welcome
   * email goes after the webhook answers.
   */
  onFirstPlanStarted?: (start: FirstPlanStart) => void;
}

/** The first plan of an account, for its welcome email. */
export interface FirstPlanStart {
  email: string;
  plan: BillingPlanId;
  serverName: string;
}

/** A closed Checkout page. `paid` when the user paid on it, so no second page must open. */
export type ClosedCheckout = { status: "paid" } | { status: "closed"; license: LicenseOrder | null };

/** The stored state of a subscription before a sync, to find the change that the sync made. */
interface StoredSubscription {
  status: string;
  plan: string;
  interval: string;
  amount: number | null;
  cancel_at_period_end: number;
}

/** A subscription that a webhook stored, with its account. */
interface SyncedSubscription {
  kind: "plan";
  userId: string;
  plan: BillingPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
  latestInvoiceId: string | null;
}

export interface CheckoutRequest {
  user: { id: string; email: string };
  serverId: string;
  plan: BillingPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
  target: BillingReturnTarget;
  origin: string;
  /** Where the journey started in the app. Only analytics reads it. */
  entryPoint?: HostedServerEntryPoint;
  /**
   * A license to buy with the server, at the bundle price for the same interval and currency. The page
   * then has 2 items, and the customer pays one invoice. The first sync moves the license to its own
   * subscription (`LicenseService.splitOrder`).
   */
  license?: LicenseOrder;
}

class BillingDependencies extends Context.Service<
  BillingDependencies,
  {
    database: D1Database;
    stripe: StripeClient;
    now: () => number;
    onSubscriptionSynced: ((sync: SubscriptionSync) => Effect.Effect<void, HostedFailure | RemoteFailure>) | null;
    analytics: AccountAnalytics;
  }
>()("auth-api/BillingService/Dependencies") {}

export class BillingService {
  readonly #layer: Layer.Layer<BillingDependencies>;

  readonly #secretKey: string;
  readonly #webhookSecret: string | null;
  readonly #analytics: AccountAnalytics;
  readonly #sales: BillingSales | null;
  readonly #onFirstPlanStarted: ((start: FirstPlanStart) => void) | null;
  /** The commercial license. It shares the Stripe customer and the webhook with the server plans. */
  readonly license: LicenseService;

  constructor(options: BillingServiceOptions) {
    const database = options.database;
    const stripe = new StripeClient(options.secretKey, options.fetch);
    this.#secretKey = options.secretKey;
    this.#webhookSecret = options.webhookSecret;
    const now = options.now ?? Date.now;
    const onSubscriptionSynced = options.onSubscriptionSynced ?? null;
    this.#analytics = options.analytics ?? NO_ACCOUNT_ANALYTICS;
    this.#sales = options.sales ?? null;
    this.#onFirstPlanStarted = options.onFirstPlanStarted ?? null;
    this.#layer = Layer.succeed(BillingDependencies, {
      database,
      stripe,
      now,
      onSubscriptionSynced,
      analytics: this.#analytics,
    });
    this.license = new LicenseService({
      database,
      stripe,
      secretKey: options.secretKey,
      trialEnd: options.licenseTrialEnd ?? null,
      now,
      ensureCustomer: (user) => this.ensureCustomer(user),
      analytics: this.#analytics,
      sales: this.#sales,
      ...(options.onLicenseChanged ? { onLicenseChanged: options.onLicenseChanged } : {}),
    });
  }

  /** The plans with their Stripe prices. A plan with no price in each currency and interval is left out. */

  readonly catalog = Effect.fn("BillingService.catalog")(
    function* (
      this: BillingService,
    ): Effect.fn.Return<HostedServerCatalog, BillingError | BillingOperationError, BillingDependencies> {
      const prices = yield* this.#prices();
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
        const entry: HostedServerCatalogPlan = {
          id: plan.id,
          diskGb: plan.storageGb,
          memberLimit: plan.memberLimit,
          relativeSpeed: plan.relativeSpeed,
          prices: { eur, usd, pln },
        };
        if (SOLD_OUT_PLANS.has(plan.id)) entry.soldOut = true;
        return [entry];
      });
      if (plans.length === 0) return yield* plansUnavailable();
      return { plans };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * The Stripe customer of the account. The service makes it before the first Checkout, so two open
   * Checkouts use one customer and the webhook always knows the account.
   */

  readonly ensureCustomer = Effect.fn("BillingService.ensureCustomer")(
    function* (
      this: BillingService,
      user: { id: string; email: string },
    ): Effect.fn.Return<string, BillingError | BillingOperationError, BillingDependencies> {
      const dependencies = yield* BillingDependencies;
      const existing = yield* this.#customerId(user.id);
      // A customer deleted in the Stripe Dashboard cannot pay, so the account gets a new one.
      if (existing && !(yield* this.#stripeCall(() => dependencies.stripe.isCustomerDeleted(existing))))
        return existing;
      const created = yield* this.#stripeCall(() =>
        dependencies.stripe.createCustomer(
          { userId: user.id, email: user.email },
          existing ? `openbot-customer-${user.id}-after-${existing}` : `openbot-customer-${user.id}`,
        ),
      );
      const now = dependencies.now();
      const store = existing
        ? dependencies.database
            .prepare(
              "UPDATE billing_customers SET stripe_customer_id = ?, updated_at = ? WHERE user_id = ? AND stripe_customer_id = ?",
            )
            .bind(created, now, user.id, existing)
        : dependencies.database
            .prepare(
              `INSERT INTO billing_customers(user_id, stripe_customer_id, created_at, updated_at)
             VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
            )
            .bind(user.id, created, now, now);
      yield* billingCall(() => store.run());
      const stored = yield* this.#customerId(user.id);
      if (!stored)
        return yield* new BillingError(500, "billing_customer_failed", "The billing account could not be saved.");
      return stored;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** A Stripe Checkout page that starts the plan of one server, and its license when the order has one. */

  readonly createCheckout = Effect.fn("BillingService.createCheckout")(
    function* (
      this: BillingService,
      request: CheckoutRequest,
    ): Effect.fn.Return<{ sessionId: string; url: string }, BillingError | BillingOperationError, BillingDependencies> {
      const dependencies = yield* BillingDependencies;
      const price = (yield* this.#prices()).get(billingLookupKey(request.plan, request.interval));
      const amount = priceAmount(price, request.currency);
      if (!price || amount === null) return yield* plansUnavailable();
      const order = request.license;
      const licensePlan = order ? { tier: order.tier, interval: request.interval, bundle: true } : null;
      const licensePrice = licensePlan ? yield* this.license.price(licensePlan) : null;
      if (licensePlan && !licensePrice)
        return yield* new BillingError(503, "license_unavailable", sourceText("error.billing.licenseUnavailable"));
      if (order) yield* this.license.assertCanOrder(request.user.id, order.users);
      yield* this.license.assertCurrency(request.user.id, request.currency);
      const customerId = yield* this.ensureCustomer(request.user);
      const returnUrl = checkoutReturnUrl(request.origin, request.target, request.serverId);
      const returnToken = this.#sales ? crypto.randomUUID() : null;
      // During a promotion the license is free until its trial end, so the order pays for the server only.
      const trialEnd = order ? this.license.trialEnd() : null;
      const orderMetadata = order
        ? {
            [ORDER_METADATA.licenseTier]: order.tier,
            [ORDER_METADATA.licenseUsers]: String(order.users),
          }
        : null;
      const session = yield* this.#stripeCall(() =>
        dependencies.stripe.createCheckoutSession({
          customerId,
          priceId: price.id,
          currency: request.currency,
          userId: request.user.id,
          serverId: request.serverId,
          ...(orderMetadata && trialEnd !== null
            ? {
                metadata: {
                  ...orderMetadata,
                  [ORDER_METADATA.licenseInterval]: request.interval,
                  [ORDER_METADATA.licenseTrialEnd]: String(Math.floor(trialEnd / 1_000)),
                },
              }
            : orderMetadata && order && licensePrice
              ? {
                  extraItems: [{ priceId: licensePrice.id, quantity: order.users }],
                  sessionMetadata: orderMetadata,
                }
              : {}),
          // Stripe puts the session ID in the URL. The desktop return page sends it with the first
          // website visit of the browser, so that the saved checkout names the account.
          successUrl:
            returnToken && request.target !== "web"
              ? `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}checkout={CHECKOUT_SESSION_ID}`
              : returnUrl,
          cancelUrl: returnToken
            ? `${request.origin}/billing/checkout-return?token=${encodeURIComponent(returnToken)}`
            : `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}cancelled=1`,
          nowSeconds: Math.floor(dependencies.now() / 1_000),
        }),
      );
      if (order) yield* this.license.keepOrderPage(customerId, session.id);
      if (this.#sales && returnToken) {
        const destination = new URL(returnUrl);
        destination.searchParams.set("cancelled", "1");
        yield* this.#sales
          .checkout({
            sessionId: session.id,
            returnToken,
            userId: request.user.id,
            serverId: request.serverId,
            plan: request.plan,
            interval: request.interval,
            currency: request.currency,
            amount,
            returnUrl: `${destination.pathname}${destination.search}`,
            createdAt: dependencies.now(),
            ...(request.entryPoint ? { entryPoint: request.entryPoint } : {}),
          })
          .pipe(Effect.mapError(() => new BillingOperationError({})));
      } else
        dependencies.analytics.track(request.user.id, {
          name: "billing_action",
          action: "checkout_started",
          product: "server",
          plan: request.plan,
          interval: request.interval,
          currency: request.currency,
          amount,
          ...(request.entryPoint ? { entryPoint: request.entryPoint } : {}),
        });
      if (order && licensePlan) {
        const licenseAmount = licensePeriodAmount(licensePlan, order.users, request.currency);
        if (this.#sales)
          yield* this.#sales
            .licenseCheckout({
              sessionId: session.id,
              userId: request.user.id,
              users: order.users,
              interval: request.interval,
              currency: request.currency,
              amount: licenseAmount,
              createdAt: dependencies.now(),
              order: true,
            })
            .pipe(Effect.catch(() => Effect.sync(() => console.warn("billing: license checkout fact was not saved"))));
        else
          dependencies.analytics.track(request.user.id, {
            name: "billing_action",
            action: "checkout_started",
            product: "license",
            users: order.users,
            interval: request.interval,
            currency: request.currency,
            amount: licenseAmount,
          });
      }
      return { sessionId: session.id, url: session.url };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Closes a Checkout page. The plan of a paid page is stored now: its webhook can be late, or can fail
   * each time. A closed page returns its license order, unless the account got a license after it opened.
   */

  readonly closeCheckout = Effect.fn("BillingService.closeCheckout")(
    function* (
      this: BillingService,
      sessionId: string,
    ): Effect.fn.Return<ClosedCheckout, BillingError | BillingOperationError, BillingDependencies> {
      const dependencies = yield* BillingDependencies;
      const session = yield* this.#stripeCall(() => dependencies.stripe.expireCheckoutSession(sessionId));
      if (session.status !== "complete") {
        const users = Number(session.metadata[ORDER_METADATA.licenseUsers]);
        const license = parseLicenseOrder({ tier: session.metadata[ORDER_METADATA.licenseTier], users });
        const userId = session.metadata[BILLING_METADATA.userId];
        return {
          status: "closed",
          license: license && userId && !(yield* this.license.hasLicense(userId)) ? license : null,
        };
      }
      const subscriptionId = session.subscription;
      if (subscriptionId) {
        // The webhook or the next close stores it. A Stripe failure is logged by `#stripeCall`.
        yield* this.#syncSubscription(subscriptionId).pipe(
          Effect.catch(() =>
            Effect.sync(() => {
              console.warn("billing: paid Checkout sync failed", { subscriptionId });
            }),
          ),
        );
      }
      return { status: "paid" };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Reads again each open plan whose period ended a day ago. Stripe moves the period end at each renewal,
   * so such a plan missed a webhook, for example a cancel while the webhook failed for 3 days.
   * Each plan is read at most once per hour.
   */

  readonly refreshLapsedPlans = Effect.fn("BillingService.refreshLapsedPlans")(
    function* (
      this: BillingService,
      now: number,
    ): Effect.fn.Return<void, BillingError | BillingOperationError, BillingDependencies> {
      const dependencies = yield* BillingDependencies;
      const rows = yield* billingCall(() =>
        dependencies.database
          .prepare(
            `SELECT stripe_subscription_id FROM billing_subscriptions
         WHERE status IN ${OPEN_STATUSES_SQL} AND current_period_end < ? AND updated_at < ?
         ORDER BY updated_at LIMIT ?`,
          )
          .bind(now - LAPSED_PLAN_GRACE_MS, now - LAPSED_PLAN_READ_INTERVAL_MS, LAPSED_PLAN_BATCH_SIZE)
          .all<{ stripe_subscription_id: string }>(),
      );
      const licenses = yield* this.license.lapsed(
        now - LAPSED_PLAN_GRACE_MS,
        now - LAPSED_PLAN_READ_INTERVAL_MS,
        LAPSED_PLAN_BATCH_SIZE,
      );
      for (const subscriptionId of [...rows.results.map((row) => row.stripe_subscription_id), ...licenses]) {
        yield* this.#syncSubscription(subscriptionId).pipe(
          Effect.catch(() =>
            Effect.sync(() => {
              console.warn("billing: lapsed plan sync failed", { subscriptionId });
            }),
          ),
        );
      }
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Cancels each open plan of one server now, with no refund. It stops at the first plan that Stripe
   * did not cancel, so the caller can keep the server.
   */

  readonly cancelServerPlans = Effect.fn("BillingService.cancelServerPlans")(
    function* (
      this: BillingService,
      userId: string,
      serverId: string,
    ): Effect.fn.Return<void, BillingError | BillingOperationError, BillingDependencies> {
      const dependencies = yield* BillingDependencies;
      const rows = yield* billingCall(() =>
        dependencies.database
          .prepare(
            `SELECT stripe_subscription_id FROM billing_subscriptions
         WHERE user_id = ? AND server_id = ? AND status IN ${OPEN_STATUSES_SQL}`,
          )
          .bind(userId, serverId)
          .all<{ stripe_subscription_id: string }>(),
      );
      for (const row of rows.results) yield* this.cancelSubscription(row.stripe_subscription_id);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly setServerRenewal = Effect.fn("BillingService.setServerRenewal")(
    function* (
      this: BillingService,
      userId: string,
      serverId: string,
      cancel: boolean,
      expectedPeriodEnd?: number,
    ): Effect.fn.Return<
      { subscriptionId: string; periodEnd: number },
      BillingError | BillingOperationError,
      BillingDependencies
    > {
      const dependencies = yield* BillingDependencies;
      const rows = yield* billingCall(() =>
        dependencies.database
          .prepare(
            `SELECT stripe_subscription_id FROM billing_subscriptions WHERE user_id = ? AND server_id = ? AND status IN ${OPEN_STATUSES_SQL}`,
          )
          .bind(userId, serverId)
          .all<{ stripe_subscription_id: string }>(),
      );
      if (rows.results.length !== 1 || !rows.results[0])
        return yield* new BillingError(409, "billing_plan_unavailable", sourceText("error.billing.lifecycleFailed"));
      const subscriptionId = rows.results[0].stripe_subscription_id;
      if (expectedPeriodEnd !== undefined) {
        const before = yield* this.#stripeCall(() => dependencies.stripe.getSubscription(subscriptionId));
        const end = subscriptionServerItem(before)?.current_period_end ?? before.current_period_end;
        if (!end || end * 1000 !== expectedPeriodEnd) {
          return yield* new BillingError(409, "billing_plan_unavailable", sourceText("error.billing.lifecycleFailed"));
        }
      }
      const subscription = yield* this.#stripeCall(() => dependencies.stripe.setRenewal(subscriptionId, cancel));
      const periodEnd = subscriptionServerItem(subscription)?.current_period_end ?? subscription.current_period_end;
      if (
        !periodEnd ||
        periodEnd * 1000 <= dependencies.now() ||
        !isOneOf(BILLING_SUBSCRIPTION_STATUSES, subscription.status) ||
        !isOpenBillingStatus(subscription.status)
      ) {
        return yield* new BillingError(409, "billing_plan_unavailable", sourceText("error.billing.lifecycleFailed"));
      }
      yield* this.#syncSubscription(subscriptionId);
      const current = yield* billingCall(() =>
        dependencies.database
          .prepare(
            `SELECT current_period_end, cancel_at_period_end FROM billing_subscriptions WHERE stripe_subscription_id = ? AND status IN ${OPEN_STATUSES_SQL}`,
          )
          .bind(subscriptionId)
          .first<{ current_period_end: number | null; cancel_at_period_end: number }>(),
      );
      if (!current?.current_period_end || current.cancel_at_period_end !== Number(cancel)) {
        return yield* new BillingError(409, "billing_plan_unavailable", sourceText("error.billing.lifecycleFailed"));
      }
      return { subscriptionId, periodEnd: current.current_period_end };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** A deletion needs a fresh terminal Stripe state, never a stale local expiry date. */
  readonly subscriptionEnded = Effect.fn("BillingService.subscriptionEnded")(
    function* (
      this: BillingService,
      subscriptionId: string,
    ): Effect.fn.Return<boolean, BillingError | BillingOperationError, BillingDependencies> {
      const dependencies = yield* BillingDependencies;
      const subscription = yield* this.#stripeCall(() => dependencies.stripe.getSubscription(subscriptionId));
      if (subscription.status !== "canceled") return false;
      yield* this.#syncSubscription(subscriptionId);
      return true;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** Cancels one subscription now. A subscription that Stripe closed already counts as cancelled. */

  readonly cancelSubscription = Effect.fn("BillingService.cancelSubscription")(
    function* (
      this: BillingService,
      subscriptionId: string,
    ): Effect.fn.Return<void, BillingError | BillingOperationError, BillingDependencies> {
      const dependencies = yield* BillingDependencies;
      const stored = yield* billingCall(() =>
        dependencies.database
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
          }>(),
      );
      yield* dependencies.stripe
        .cancelSubscription(subscriptionId)
        .pipe(Effect.mapError((error) => (error instanceof StripeRequestError ? error : new BillingOperationError({}))))
        .pipe(
          Effect.catch((error) => {
            if (!(error instanceof StripeRequestError)) return Effect.fail(error);
            return dependencies.stripe
              .getSubscription(subscriptionId)
              .pipe(
                Effect.mapError((error) =>
                  error instanceof StripeRequestError ? error : new BillingOperationError({}),
                ),
              )
              .pipe(
                Effect.flatMap((current) =>
                  current.status === "canceled" || current.status === "incomplete_expired"
                    ? Effect.void
                    : Effect.fail(error),
                ),
              );
          }),
          Effect.mapError(stripeFailure),
        );
      // The webhook stores the final state later. Until then the plan must not count as open.
      yield* billingCall(() =>
        dependencies.database
          .prepare(
            `UPDATE billing_subscriptions SET status = 'canceled', cancel_at_period_end = 0, updated_at = ?
         WHERE stripe_subscription_id = ?`,
          )
          .bind(dependencies.now(), subscriptionId)
          .run(),
      );
      // The webhook that follows sees the plan closed already, so the end is reported here.
      if (stored && isOneOf(BILLING_SUBSCRIPTION_STATUSES, stored.status) && isOpenBillingStatus(stored.status)) {
        dependencies.analytics.track(stored.user_id, {
          name: "billing_action",
          action: "plan_ended",
          ...(isOneOf(BILLING_PLAN_IDS, stored.plan) ? { plan: stored.plan } : {}),
          ...(isOneOf(BILLING_INTERVALS, stored.interval) ? { interval: stored.interval } : {}),
          ...(isBillingCurrency(stored.currency) ? { currency: stored.currency } : {}),
          amount: stored.amount,
        });
      }
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** The open plan of each server. The server name comes only from a host that the same account owns. */

  readonly getState = Effect.fn("BillingService.getState")(
    function* (
      this: BillingService,
      userId: string,
    ): Effect.fn.Return<BillingState, BillingError | BillingOperationError, BillingDependencies> {
      const dependencies = yield* BillingDependencies;
      const [customer, rows] = yield* Effect.all(
        [
          this.#customerId(userId),
          billingCall(() =>
            dependencies.database
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
          ),
        ],
        { concurrency: "unbounded" },
      );
      const servers = rows.results.flatMap((row) => {
        const server = serverPlan(row);
        return server ? [server] : [];
      });
      return { available: true, hasCustomer: customer !== null, servers };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Returns a Customer Portal page. The plan change and cancel flows open on one subscription, after
   * the service checks that the subscription belongs to the account.
   */

  readonly createPortal = Effect.fn("BillingService.createPortal")(
    function* (
      this: BillingService,
      userId: string,
      request: BillingPortalRequest,
      target: BillingReturnTarget,
      origin: string,
    ): Effect.fn.Return<string, BillingError | BillingOperationError, BillingDependencies> {
      const dependencies = yield* BillingDependencies;
      const customerId = yield* this.#customerId(userId);
      if (!customerId) return yield* new BillingError(404, "no_customer", "No billing account exists yet.");
      const returnUrl = portalReturnUrl(origin, target);
      dependencies.analytics.track(userId, { name: "billing_action", action: "portal_opened", flow: request.flow });
      if (request.flow === "manage") {
        return yield* this.#stripeCall(() => dependencies.stripe.createPortalSession({ customerId, returnUrl }));
      }
      const owned = yield* billingCall(() =>
        dependencies.database
          .prepare(
            `SELECT 1 AS owned FROM billing_subscriptions
         WHERE stripe_subscription_id = ? AND user_id = ? AND stripe_customer_id = ? AND status IN ${OPEN_STATUSES_SQL}`,
          )
          .bind(request.subscriptionId, userId, customerId)
          .first<{ owned: number }>(),
      );
      if (!owned) return yield* new BillingError(404, "no_subscription", "This plan does not exist.");
      const type = request.flow === "update" ? "subscription_update" : "subscription_cancel";
      return yield* this.#stripeCall(() =>
        dependencies.stripe.createPortalSession({
          customerId,
          returnUrl,
          flow: { type, subscriptionId: request.subscriptionId },
        }),
      );
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Applies one Stripe event. Each event gets the subscription from Stripe again, so a late or repeated
   * event cannot write an old state. An error makes the route answer 500, so Stripe sends the event again.
   */

  readonly handleWebhook = Effect.fn("BillingService.handleWebhook")(
    function* (
      this: BillingService,
      payload: string,
      signature: string | null,
    ): Effect.fn.Return<void, BillingError | BillingOperationError, BillingDependencies> {
      const dependencies = yield* BillingDependencies;
      const webhookSecret = this.#webhookSecret;
      if (!webhookSecret) return yield* new BillingError(503, "billing_unavailable", "Billing is not available.");
      const now = dependencies.now();
      if (
        !(yield* verifyStripeSignature(payload, signature, webhookSecret, now).pipe(
          Effect.mapError((error) => (error instanceof BillingError ? error : new BillingOperationError({}))),
        ))
      ) {
        return yield* new BillingError(400, "invalid_signature", "The Stripe signature is invalid.");
      }
      const event = parseStripeEvent(payload);
      if (!event) return yield* new BillingError(400, "invalid_event", "The Stripe event is invalid.");
      const seen = yield* billingCall(() =>
        dependencies.database
          .prepare("SELECT 1 AS seen FROM billing_webhook_events WHERE event_id = ?")
          .bind(event.id)
          .first<{ seen: number }>(),
      );
      if (seen) return;
      // A refund or a dispute names only its payment. The invoice of that payment names the plan.
      const reversal = paymentReversal(event);
      const payment = reversal
        ? yield* this.#stripeCall(() => dependencies.stripe.getPaymentInvoice(reversal.paymentIntentId))
        : null;
      const subscriptionId = eventSubscriptionId(event) ?? payment?.subscriptionId ?? null;
      const synced = subscriptionId ? yield* this.#syncSubscription(subscriptionId) : null;
      // The server of an ended plan stops and keeps its disk.
      if (reversal && payment && synced && (yield* this.#reversalEndsPlan(reversal, payment, synced))) {
        yield* this.cancelSubscription(payment.subscriptionId);
        yield* this.#syncSubscription(payment.subscriptionId);
      }
      // License events count as sales with `product: license`. The sync reports the license lifecycle.
      const sold: BillingSalesSynced | null =
        synced?.kind === "license"
          ? {
              product: "license",
              userId: synced.userId,
              users: synced.users,
              interval: synced.interval,
              currency: synced.currency,
            }
          : synced;
      if (this.#sales) {
        yield* this.#sales.webhook(event, sold, payment).pipe(Effect.mapError(() => new BillingOperationError({})));
      }
      // The event is recorded only after it is applied, so a failed event is applied again on retry.
      yield* billingCall(() =>
        dependencies.database.batch([
          dependencies.database
            .prepare("INSERT OR IGNORE INTO billing_webhook_events(event_id, type, received_at) VALUES (?, ?, ?)")
            .bind(event.id, event.type, now),
          dependencies.database
            .prepare("DELETE FROM billing_webhook_events WHERE received_at < ?")
            .bind(now - WEBHOOK_EVENT_RETENTION_MS),
        ]),
      );
      if (!this.#sales) yield* this.#trackEvent(event, synced);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * A dispute ends the plan now, so Stripe does not charge the disputed card again. A full refund of the
   * invoice that paid the current period ends it too, because the account paid nothing for that period.
   * A partial refund, or a refund of an earlier invoice or of a plan change, keeps the plan.
   */
  readonly #reversalEndsPlan = Effect.fn("BillingService.reversalEndsPlan")(function* (
    this: BillingService,
    reversal: PaymentReversal,
    payment: { invoiceId: string; billingReason: string | null },
    synced: SyncedSubscription | LicenseSync,
  ): Effect.fn.Return<boolean, BillingError | BillingOperationError, BillingDependencies> {
    if (reversal.type === "payment_disputed") return true;
    if (reversal.type !== "payment_refunded") return false;
    if (payment.invoiceId !== synced.latestInvoiceId) return false;
    if (payment.billingReason !== "subscription_create" && payment.billingReason !== "subscription_cycle") return false;
    const dependencies = yield* BillingDependencies;
    return yield* this.#stripeCall(() => dependencies.stripe.isPaymentRefunded(reversal.paymentIntentId));
  });

  /** Reports a payment or an expired Checkout. A change of the plan itself is reported by the sync. */
  readonly #trackEvent = Effect.fn("BillingService.trackEvent")(function* (
    this: BillingService,
    event: StripeEvent,
    synced: SyncedSubscription | LicenseSync | null,
  ): Effect.fn.Return<void, BillingError | BillingOperationError, BillingDependencies> {
    const dependencies = yield* BillingDependencies;
    const object = event.data.object;
    if (event.type === "checkout.session.expired") {
      const userId = isDynamicRecord(object.metadata) ? object.metadata[BILLING_METADATA.userId] : null;
      const user = isString(userId)
        ? yield* billingCall(() =>
            dependencies.database.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first<{ id: string }>(),
          )
        : null;
      if (user)
        dependencies.analytics.track(user.id, {
          name: "billing_action",
          action: "checkout_expired",
          product: isLicenseCheckout(event) ? "license" : "server",
        });
      return;
    }
    if (!synced || (event.type !== "invoice.paid" && event.type !== "invoice.payment_failed")) return;
    const paid = event.type === "invoice.paid";
    const amount = paid ? object.amount_paid : object.amount_due;
    const currency = isString(object.currency) ? object.currency.toLowerCase() : null;
    dependencies.analytics.track(synced.userId, {
      name: "billing_action",
      action: paid ? "payment_succeeded" : "payment_failed",
      product: synced.kind === "license" ? "license" : "server",
      ...(synced.kind === "license" ? { users: synced.users } : { plan: synced.plan }),
      interval: synced.interval,
      currency: synced.currency,
      amount: currency === synced.currency && isBillingAmount(amount) ? amount : null,
    });
  });

  readonly #syncSubscription = Effect.fn("BillingService.syncSubscription")(function* (
    this: BillingService,
    subscriptionId: string,
  ): Effect.fn.Return<
    SyncedSubscription | LicenseSync | null,
    BillingError | BillingOperationError,
    BillingDependencies
  > {
    const dependencies = yield* BillingDependencies;
    // The time of the read, not of the write: a read that started later holds the newer state.
    const readAt = dependencies.now();
    const subscription = yield* this.#stripeCall(() => dependencies.stripe.getSubscription(subscriptionId));
    const customerId = subscriptionCustomerId(subscription);
    // A server order has a server item and a license item until its split. It is a server plan.
    const price = subscriptionServerItem(subscription)?.price;
    if (!price && subscriptionLicenseItem(subscription)) {
      const ownerId = yield* this.#subscriptionOwner(subscription, customerId);
      return ownerId ? yield* this.license.sync(subscription, ownerId, readAt) : null;
    }
    // A changed amount moves the lookup key to a new Price, and current subscriptions keep the old one.
    const key =
      parseBillingLookupKey(price?.lookup_key) ??
      parseBillingLookupKey(`openbot_${price?.metadata.openbot_plan}_${price?.metadata.openbot_interval}`);
    const currency = subscription.currency.toLowerCase();
    if (!key || !isBillingCurrency(currency) || !isOneOf(BILLING_SUBSCRIPTION_STATUSES, subscription.status)) {
      console.warn("billing: subscription is not an OpenBot plan", { subscriptionId });
      return null;
    }
    const ownerId = yield* this.#subscriptionOwner(subscription, customerId);
    if (!ownerId) return null;
    const metadataServerId = subscription.metadata[BILLING_METADATA.serverId];
    const serverId = metadataServerId && SERVER_ID_PATTERN.test(metadataServerId) ? metadataServerId : null;
    const previous = yield* billingCall(() =>
      dependencies.database
        .prepare(
          "SELECT status, plan, interval, amount, cancel_at_period_end FROM billing_subscriptions WHERE stripe_subscription_id = ?",
        )
        .bind(subscription.id)
        .first<StoredSubscription>(),
    );
    const cancelAtPeriodEnd = subscription.cancel_at_period_end || typeof subscription.cancel_at === "number";
    const amount = subscriptionAmount(subscription);
    // Two events for one subscription can run at the same time. The write of the older read is skipped.
    const stored = yield* billingCall(() =>
      dependencies.database
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
        .run(),
    );
    const synced: SyncedSubscription = {
      kind: "plan",
      userId: ownerId,
      plan: key.plan,
      interval: key.interval,
      currency,
      latestInvoiceId: subscriptionLatestInvoiceId(subscription),
    };
    // A paid server order moves its license to its own subscription, and any server plan gives the license
    // the bundle price from its next renewal. A sync that stores nothing new also runs both, so a failed
    // split or price change runs again on the next webhook. Each does nothing when it is already done.
    const finish = Effect.andThen(
      ordersLicense(subscription) ? this.license.splitOrder(subscription, ownerId) : Effect.void,
      this.license.alignBundlePrice(ownerId),
    );
    if (stored.meta.changes !== 1) {
      yield* finish;
      return synced;
    }
    const current = { ...synced, amount, status: subscription.status, cancelAtPeriodEnd };
    const action = planChange(previous, current);
    // The other plans of an account whose plan starts. A failed read leaves them out: the subscription
    // is already saved, so the event must not fail the sync.
    const others =
      action === "plan_started"
        ? yield* billingCall(() =>
            dependencies.database
              .prepare("SELECT status FROM billing_subscriptions WHERE user_id = ? AND stripe_subscription_id <> ?")
              .bind(ownerId, subscription.id)
              .all<{ status: string }>(),
          ).pipe(
            Effect.map(({ results }) => results),
            Effect.catch(() => Effect.succeed(null)),
          )
        : null;
    // A plan that starts after every earlier plan of the account ended.
    const reactivated = others
      ? others.some((row) => row.status === "canceled") &&
        !others.some((row) => isOneOf(BILLING_SUBSCRIPTION_STATUSES, row.status) && isOpenBillingStatus(row.status))
      : undefined;
    if (action) this.#trackChange(action, previous, current, reactivated);
    // A subscription starts once, so the first plan of an account starts once.
    if (others?.length === 0 && serverId) yield* this.#firstPlanStarted(ownerId, serverId, key.plan);
    const onSubscriptionSynced = dependencies.onSubscriptionSynced;
    const status = subscription.status;
    if (serverId && onSubscriptionSynced) {
      yield* onSubscriptionSynced({
        subscriptionId,
        userId: ownerId,
        serverId,
        status,
        plan: key.plan,
        interval: key.interval,
        currency,
      }).pipe(Effect.mapError((error) => (error instanceof BillingError ? error : new BillingOperationError({}))));
    }
    yield* finish;
    return synced;
  });

  /**
   * Claims the welcome of an account before it is sent. Stripe sends the events of a new subscription
   * at the same time, and each one can see the start, so only the event that adds the claim sends it.
   * The claim is kept as long as the webhook events. A failure skips the email, not the sync.
   */
  readonly #firstPlanStarted = Effect.fn("BillingService.firstPlanStarted")(
    function* (
      this: BillingService,
      userId: string,
      serverId: string,
      plan: BillingPlanId,
    ): Effect.fn.Return<void, BillingError | BillingOperationError, BillingDependencies> {
      const send = this.#onFirstPlanStarted;
      if (!send) return;
      const dependencies = yield* BillingDependencies;
      const claim = yield* billingCall(() =>
        dependencies.database
          .prepare("INSERT OR IGNORE INTO billing_webhook_events(event_id, type, received_at) VALUES (?, ?, ?)")
          .bind(`${WELCOME_EMAIL_CLAIM_PREFIX}${userId}`, "welcome_email", dependencies.now())
          .run(),
      );
      if (claim.meta.changes !== 1) return;
      const account = yield* billingCall(() =>
        dependencies.database
          .prepare(
            `SELECT u.email, s.name AS server_name FROM users u
             JOIN hosted_servers s ON s.server_id = ? AND s.owner_user_id = u.id
             WHERE u.id = ?`,
          )
          .bind(serverId, userId)
          .first<{ email: string; server_name: string }>(),
      );
      if (account) send({ email: account.email, plan, serverName: account.server_name });
    },
    (operation) =>
      operation.pipe(
        Effect.catch(() => Effect.sync(() => console.warn("billing: welcome email skipped: the read failed"))),
      ),
  );

  /** Reports the change of a plan that one sync made. A sync that changes nothing reports nothing. */
  #trackChange(
    action: BillingAction,
    previous: StoredSubscription | null,
    current: SyncedSubscription & { amount: number | null },
    reactivated: boolean | undefined,
  ): void {
    const direction = action === "plan_changed" ? planChangeDirection(previous, current) : null;
    this.#analytics.track(current.userId, {
      name: "billing_action",
      action,
      product: "server",
      plan: current.plan,
      interval: current.interval,
      currency: current.currency,
      amount: current.amount,
      ...(direction ? { direction } : {}),
      ...(reactivated === undefined ? {} : { reactivated }),
      ...(action === "plan_ended" ? { endReason: planEndReason(previous) } : {}),
    });
  }

  readonly #prices = Effect.fn("BillingService.prices")(function* (
    this: BillingService,
  ): Effect.fn.Return<ReadonlyMap<string, StripePrice>, BillingError | BillingOperationError, BillingDependencies> {
    const dependencies = yield* BillingDependencies;
    const cached = catalogCache.get(this.#secretKey);
    const now = dependencies.now();
    if (cached && cached.expiresAt > now) return cached.prices;
    const lookupKeys = BILLING_PLAN_IDS.flatMap((plan) =>
      BILLING_INTERVALS.map((interval) => billingLookupKey(plan, interval)),
    );
    const list = yield* this.#stripeCall(() => dependencies.stripe.listPricesByLookupKeys(lookupKeys));
    const prices = new Map(list.flatMap((price) => (price.lookup_key ? [[price.lookup_key, price] as const] : [])));
    catalogCache.set(this.#secretKey, { expiresAt: now + CATALOG_TTL_MS, prices });
    return prices;
  });

  /**
   * The account of a subscription. A known customer names it. For a new customer, the subscription
   * metadata names the account, and the service links the customer to it. The service never moves a
   * customer or an account to a second link.
   */
  readonly #subscriptionOwner = Effect.fn("BillingService.subscriptionOwner")(function* (
    this: BillingService,
    subscription: StripeSubscription,
    customerId: string,
  ): Effect.fn.Return<string | null, BillingError | BillingOperationError, BillingDependencies> {
    const dependencies = yield* BillingDependencies;
    // A stored subscription keeps its account, also after the account gets a new customer.
    const stored = yield* billingCall(() =>
      dependencies.database
        .prepare("SELECT user_id FROM billing_subscriptions WHERE stripe_subscription_id = ?")
        .bind(subscription.id)
        .first<{ user_id: string }>(),
    );
    if (stored) return stored.user_id;
    const license = yield* this.license.storedOwner(subscription.id);
    if (license) return license;
    const known = yield* billingCall(() =>
      dependencies.database
        .prepare("SELECT user_id FROM billing_customers WHERE stripe_customer_id = ?")
        .bind(customerId)
        .first<{ user_id: string }>(),
    );
    if (known) return known.user_id;
    const userId = subscription.metadata[BILLING_METADATA.userId];
    const user = userId
      ? yield* billingCall(() =>
          dependencies.database.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first<{ id: string }>(),
        )
      : null;
    if (!user) {
      console.warn("billing: subscription names no OpenBot account", { subscriptionId: subscription.id });
      return null;
    }
    const now = dependencies.now();
    yield* billingCall(() =>
      dependencies.database
        .prepare(
          `INSERT INTO billing_customers(user_id, stripe_customer_id, created_at, updated_at)
         VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        )
        .bind(user.id, customerId, now, now)
        .run(),
    );
    if ((yield* this.#customerId(user.id)) === customerId) return user.id;
    console.warn("billing: account already has another Stripe customer", { subscriptionId: subscription.id });
    return null;
  });

  readonly #customerId = Effect.fn("BillingService.customerId")(function* (
    this: BillingService,
    userId: string,
  ): Effect.fn.Return<string | null, BillingError | BillingOperationError, BillingDependencies> {
    const dependencies = yield* BillingDependencies;
    const row = yield* billingCall(() =>
      dependencies.database
        .prepare("SELECT stripe_customer_id FROM billing_customers WHERE user_id = ?")
        .bind(userId)
        .first<{ stripe_customer_id: string }>(),
    );
    return row?.stripe_customer_id ?? null;
  });

  readonly #stripeCall = Effect.fn("BillingService.stripeCall")(
    <T>(call: () => Effect.Effect<T, StripeRequestError | StripeTransportError>) =>
      stripeRequest(call).pipe(Effect.mapError(stripeFailure)),
  );
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

/**
 * Whether a changed plan costs more or less. The monthly amounts decide; without both amounts, the order
 * of the plans decides. A change of interval only at the same monthly amount has no direction.
 */
function planChangeDirection(
  previous: StoredSubscription | null,
  current: { plan: BillingPlanId; interval: BillingInterval; amount: number | null },
): PlanChangeDirection | null {
  if (!previous) return null;
  const monthly = (amount: number, interval: string) => (interval === "year" ? amount / 12 : amount);
  if (previous.amount !== null && current.amount !== null) {
    const before = monthly(previous.amount, previous.interval);
    const after = monthly(current.amount, current.interval);
    if (after !== before) return after > before ? "up" : "down";
    return null;
  }
  const before = isOneOf(BILLING_PLAN_IDS, previous.plan) ? BILLING_PLAN_IDS.indexOf(previous.plan) : -1;
  const after = BILLING_PLAN_IDS.indexOf(current.plan);
  if (before < 0 || before === after) return null;
  return after > before ? "up" : "down";
}

/** A plan that ends after its payment failed ends as unpaid; every other end is a cancellation. */
function planEndReason(previous: StoredSubscription | null): PlanEndReason {
  return previous?.status === "past_due" || previous?.status === "unpaid" ? "unpaid" : "canceled";
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
  // `kind` tells the return page which Stripe page closed.
  return `${origin}/billing/return?kind=plan`;
}

function portalReturnUrl(origin: string, target: BillingReturnTarget): string {
  if (target === "web") return `${origin}/app?billing=portal`;
  return `${origin}/billing/return?kind=portal`;
}

/** True for a Checkout event of a license page. A paid page also names its subscription, which the sync reads. */
function isLicenseCheckout(event: StripeEvent): boolean {
  if (!event.type.startsWith("checkout.session.")) return false;
  const metadata = event.data.object.metadata;
  return isDynamicRecord(metadata) && metadata[LICENSE_METADATA.kind] === LICENSE_METADATA_KIND;
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
