import {
  BILLING_INTERVALS,
  BILLING_METADATA,
  BILLING_OPTIONAL_CURRENCIES,
  BILLING_PLAN_IDS,
  BILLING_PLANS,
  BILLING_STORAGE_UPGRADE_TIERS,
  BILLING_SUBSCRIPTION_STATUSES,
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
  type BillingPortalRequest,
  type BillingServerPlan,
  type BillingState,
  type BillingStorageRequest,
  type BillingStorageTier,
  type BillingStorageUpgrade,
  type BillingStorageUpgradeTier,
  type BillingSubscriptionStatus,
  billingLookupKey,
  isBillingAmount,
  isOpenBillingStatus,
  parseBillingLookupKey,
  storageTierGb,
  storageTierLookupKey,
  storageTierOf,
} from "@openbot/contracts/billing";
import type { BillingDetails, BillingDetailsRequest } from "@openbot/contracts/billing-details";
import {
  CUSTOM_SERVER_METADATA_KIND,
  CUSTOM_SERVER_PAID_STATUSES,
  type CustomServerPlan,
} from "@openbot/contracts/custom-server-plans";
import type {
  HostedServerCatalog,
  HostedServerCatalogPlan,
  HostedServerEntryPoint,
  HostedServerPlanPrices,
} from "@openbot/contracts/hosted-servers";
import {
  LICENSE_METADATA,
  LICENSE_METADATA_KIND,
  type LicenseOrder,
  licensePeriodAmount,
  ORDER_METADATA,
  parseLicenseOrder,
} from "@openbot/contracts/license";
import type { ReferralMoney } from "@openbot/contracts/referral";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Context, Effect, Exit, Layer } from "effect";
import { SOLD_OUT_PLANS } from "../lib/pricing-page";
import {
  type AccountAnalytics,
  type BillingAction,
  NO_ACCOUNT_ANALYTICS,
  type PlanChangeDirection,
  type PlanEndReason,
} from "./account-analytics";
import { subscriptionPaysForOwnerSql } from "./billing-entitlement";
import {
  BillingError,
  BillingOperationError,
  billingCall,
  OPEN_STATUSES_SQL,
  stripeFailure,
  stripeRequest,
} from "./billing-errors";
import type { BillingOss } from "./billing-oss";
import { type BillingPurchase, purchaseEvent, reportPurchase, subscriptionEnd } from "./billing-purchase";
import { BillingReferral } from "./billing-referral";
import {
  type BillingSales,
  type BillingSalesSynced,
  isDisputeInquiry,
  paymentReversal,
  withoutTax,
} from "./billing-sales";
import { billingDetailsOf, checkoutCountryMismatch, checkoutTax, setCustomerBillingDetails } from "./billing-tax";
import { CreditGrants } from "./credit-grants";
import { CreditService, isCreditCheckoutEvent, isCreditInvoiceEvent } from "./credit-service";
import type { HostedFailure } from "./hosted-server-service";
import {
  type FailedLicenseInvoice,
  LicenseService,
  type LicenseServiceOptions,
  type LicenseSync,
  ordersLicense,
} from "./license-service";
import { Referrals } from "./referrals";
import type { RemoteFailure } from "./remote-control-plane";
import type { StripeTransportError } from "./stripe-client";
import {
  EARLY_START_METADATA,
  isBillingCurrency,
  parseStripeEvent,
  priceHasCurrency,
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
  subscriptionPaymentMethodId,
  subscriptionPeriodEnd,
  subscriptionServerItem,
  subscriptionStartedAt,
  subscriptionStorageItem,
  subscriptionStorageTier,
  verifyStripeSignature,
} from "./stripe-client";
import { ViesClient } from "./vies-client";

const WEBHOOK_EVENT_RETENTION_MS = 7 * 24 * 60 * 60_000;
const WELCOME_EMAIL_CLAIM_PREFIX = "openbot_welcome_email:";
const SERVER_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/u;
const DISPUTE_DELETES_SERVER_MS = 30 * 24 * 60 * 60 * 1000;
const LAPSED_PLAN_GRACE_MS = 24 * 60 * 60 * 1000;
const LAPSED_PLAN_READ_INTERVAL_MS = 60 * 60 * 1000;
const LAPSED_PLAN_BATCH_SIZE = 20;
const CATALOG_TTL_MS = 5 * 60_000;
const catalogCache = new Map<string, { expiresAt: number; prices: ReadonlyMap<string, StripePrice> }>();
const NO_PRICES: ReadonlyMap<string, StripePrice> = new Map();
const STORAGE_PURCHASE_WINDOW_MS = 60_000;

export { BillingError } from "./billing-errors";

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
  on_operator_host: number;
  storage_tier: number;
}

export interface SubscriptionSync {
  subscriptionId: string;
  userId: string;
  serverId: string;
  status: BillingSubscriptionStatus;
  plan: BillingPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
  storageTier: BillingStorageTier;
}

export interface BillingServiceOptions {
  database: D1Database;
  secretKey: string;
  webhookSecret: string | null;
  licenseTrialEnd?: number | null;
  countryRequired?: boolean;
  fetch: StripeFetch;
  now?: () => number;
  onSubscriptionSynced?: (sync: SubscriptionSync) => Effect.Effect<void, HostedFailure | RemoteFailure>;
  onCustomServerChanged?: (hostId: string) => Effect.Effect<void, RemoteFailure>;
  onServerRefunded?: (refund: ServerRefund) => Effect.Effect<void, HostedFailure>;
  onLicenseChanged?: (userId: string) => Effect.Effect<void, RemoteFailure>;
  analytics?: AccountAnalytics;
  sales?: BillingSales;
  onFirstPlanStarted?: (start: FirstPlanStart) => void;
  onLicenseEmail?: LicenseServiceOptions["onLicenseEmail"];
  onPurchase?: (purchase: BillingPurchase) => void;
  vies?: ViesClient;
  onVatMismatch?: (text: string) => void;
  oss?: BillingOss;
}

export interface ServerRefund {
  userId: string;
  serverId: string;
}

export interface FirstPlanStart {
  email: string;
  plan: BillingPlanId;
  serverName: string;
}

export type ClosedCheckout = { status: "paid" } | ({ status: "closed" } & CheckoutOrder);

export interface CheckoutOrder {
  license: LicenseOrder | null;
  earlyStartAt: number | null;
}

interface StoredSubscription {
  status: string;
  plan: string;
  interval: string;
  amount: number | null;
  cancel_at_period_end: number;
}

interface SyncedSubscription {
  kind: "plan";
  userId: string;
  plan: BillingPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
  latestInvoiceId: string | null;
  serverId: string | null;
  ended: boolean;
  startedAt: number | null;
}

interface CustomServerSync {
  kind: "custom_server";
}

export interface CustomServerCheckoutRequest {
  user: { id: string; email: string };
  serverId: string;
  plan: CustomServerPlan;
  target: BillingReturnTarget;
  origin: string;
  earlyStartAt?: number;
}

export interface CheckoutRequest {
  user: { id: string; email: string };
  serverId: string;
  plan: BillingPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
  target: BillingReturnTarget;
  origin: string;
  entryPoint?: HostedServerEntryPoint;
  license?: LicenseOrder;
  earlyStartAt?: number;
  promotionCode?: string;
}

class BillingDependencies extends Context.Service<
  BillingDependencies,
  {
    database: D1Database;
    stripe: StripeClient;
    now: () => number;
    onSubscriptionSynced: ((sync: SubscriptionSync) => Effect.Effect<void, HostedFailure | RemoteFailure>) | null;
    onCustomServerChanged: ((hostId: string) => Effect.Effect<void, RemoteFailure>) | null;
    onServerRefunded: ((refund: ServerRefund) => Effect.Effect<void, HostedFailure>) | null;
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
  readonly #onPurchase: ((purchase: BillingPurchase) => void) | null;
  readonly #vies: ViesClient;
  readonly #onVatMismatch: ((text: string) => void) | null;
  readonly #oss: BillingOss | null;
  readonly #referral: BillingReferral;
  readonly #countryRequired: boolean;
  readonly license: LicenseService;
  readonly credits: CreditService;

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
    this.#onPurchase = options.onPurchase ?? null;
    this.#vies = options.vies ?? new ViesClient(options.fetch, null);
    this.#onVatMismatch = options.onVatMismatch ?? null;
    this.#oss = options.oss ?? null;
    this.#countryRequired = options.countryRequired ?? false;
    this.#layer = Layer.succeed(BillingDependencies, {
      database,
      stripe,
      now,
      onSubscriptionSynced,
      onCustomServerChanged: options.onCustomServerChanged ?? null,
      onServerRefunded: options.onServerRefunded ?? null,
      analytics: this.#analytics,
    });
    this.#referral = new BillingReferral({
      database,
      stripe,
      referrals: new Referrals({ database, now }),
      now,
      ensureCustomer: (user) => this.ensureCustomer(user),
    });
    this.credits = new CreditService({
      database,
      stripe,
      secretKey: options.secretKey,
      countryRequired: this.#countryRequired,
      now,
      ensureCustomer: (user) => this.ensureCustomer(user),
    });
    this.license = new LicenseService({
      database,
      stripe,
      secretKey: options.secretKey,
      trialEnd: options.licenseTrialEnd ?? null,
      countryRequired: this.#countryRequired,
      now,
      ensureCustomer: (user) => this.ensureCustomer(user),
      referralCoupon: (userId) => this.#referral.couponFor(userId),
      keptReferralCoupon: (subscriptionId) => this.#referral.keptCoupon(subscriptionId),
      analytics: this.#analytics,
      sales: this.#sales,
      ...(options.onLicenseChanged ? { onLicenseChanged: options.onLicenseChanged } : {}),
      ...(options.onLicenseEmail ? { onLicenseEmail: options.onLicenseEmail } : {}),
      ...(options.onPurchase ? { onPurchase: options.onPurchase } : {}),
    });
  }

  readonly catalog = Effect.fn("BillingService.catalog")(
    function* (
      this: BillingService,
    ): Effect.fn.Return<HostedServerCatalog, BillingError | BillingOperationError, BillingDependencies> {
      const prices = yield* this.#prices();
      const plans = BILLING_PLANS.flatMap((plan): HostedServerCatalogPlan[] => {
        const amounts = (currency: BillingCurrency): Record<BillingInterval, number> | null => {
          const month = priceAmount(prices.get(billingLookupKey(plan.id, "month")), currency);
          const year = priceAmount(prices.get(billingLookupKey(plan.id, "year")), currency);
          return month === null || year === null ? null : { month, year };
        };
        const eur = amounts("eur");
        const usd = amounts("usd");
        const pln = amounts("pln");
        if (!eur || !usd || !pln) return [];
        const planPrices: HostedServerPlanPrices = { eur, usd, pln };
        for (const currency of BILLING_OPTIONAL_CURRENCIES) {
          const optional = amounts(currency);
          if (optional) planPrices[currency] = optional;
        }
        const entry: HostedServerCatalogPlan = {
          id: plan.id,
          diskGb: storageTierGb(plan.id, 0),
          memberLimit: plan.memberLimit,
          relativeSpeed: plan.relativeSpeed,
          prices: planPrices,
        };
        if (SOLD_OUT_PLANS.has(plan.id)) entry.soldOut = true;
        return [entry];
      });
      if (plans.length === 0) return yield* plansUnavailable();
      return { plans };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly referralCredit = (userId: string): Effect.Effect<ReferralMoney[], BillingError | BillingOperationError> =>
    this.#referral.credit(userId);

  readonly releaseReferralCredit = (): Effect.Effect<number, BillingError | BillingOperationError> =>
    this.#referral.releaseDue();

  readonly ensureCustomer = Effect.fn("BillingService.ensureCustomer")(
    function* (
      this: BillingService,
      user: { id: string; email: string },
    ): Effect.fn.Return<string, BillingError | BillingOperationError, BillingDependencies> {
      const dependencies = yield* BillingDependencies;
      const existing = yield* this.#customerId(user.id);
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

  readonly getBillingDetails = Effect.fn("BillingService.getBillingDetails")(
    function* (
      this: BillingService,
      userId: string,
    ): Effect.fn.Return<BillingDetails, BillingError | BillingOperationError, BillingDependencies> {
      const dependencies = yield* BillingDependencies;
      const customerId = yield* this.#customerId(userId);
      if (!customerId) return billingDetailsOf(null);
      return billingDetailsOf(yield* this.#stripeCall(() => dependencies.stripe.getCustomerTax(customerId)));
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly setBillingDetails = Effect.fn("BillingService.setBillingDetails")(
    function* (
      this: BillingService,
      user: { id: string; email: string },
      request: BillingDetailsRequest,
    ): Effect.fn.Return<BillingDetails, BillingError | BillingOperationError, BillingDependencies> {
      const dependencies = yield* BillingDependencies;
      const customerId = yield* this.ensureCustomer(user);
      const saved = yield* setCustomerBillingDetails(
        dependencies.stripe,
        this.#vies,
        customerId,
        request,
        dependencies.now(),
      );
      for (const text of saved.vatChanges) {
        console.warn(`billing: ${text}`);
        this.#onVatMismatch?.(text);
      }
      return saved.details;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

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
      if (licensePlan && (!licensePrice || !priceHasCurrency(licensePrice, request.currency)))
        return yield* new BillingError(503, "license_unavailable", sourceText("error.billing.licenseUnavailable"));
      if (order) yield* this.license.assertCanOrder(request.user.id, order.users);
      yield* this.license.assertCurrency(request.user.id, request.currency);
      const customerId = yield* this.ensureCustomer(request.user);
      const tax = yield* checkoutTax(dependencies.stripe, customerId, this.#countryRequired);
      const referralCouponId = yield* this.#referral.couponFor(request.user.id);
      const returnUrl = checkoutReturnUrl(request.origin, request.target, request.serverId);
      const returnToken = this.#sales ? crypto.randomUUID() : null;
      const trialEnd = order ? this.license.trialEnd() : null;
      const orderMetadata = order
        ? {
            [ORDER_METADATA.licenseTier]: order.tier,
            [ORDER_METADATA.licenseUsers]: String(order.users),
          }
        : null;
      const trial = orderMetadata !== null && trialEnd !== null;
      const metadata = {
        ...(trial
          ? {
              ...orderMetadata,
              [ORDER_METADATA.licenseInterval]: request.interval,
              [ORDER_METADATA.licenseTrialEnd]: String(Math.floor(trialEnd / 1_000)),
            }
          : {}),
        ...(request.earlyStartAt === undefined
          ? {}
          : { [EARLY_START_METADATA]: new Date(request.earlyStartAt).toISOString() }),
      };
      const session = yield* this.#stripeCall(() =>
        dependencies.stripe.createCheckoutSession({
          customerId,
          priceId: price.id,
          currency: request.currency,
          userId: request.user.id,
          serverId: request.serverId,
          tax,
          ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
          ...(!trial && orderMetadata && order && licensePrice
            ? {
                extraItems: [{ priceId: licensePrice.id, quantity: order.users }],
                sessionMetadata: orderMetadata,
              }
            : {}),
          ...(request.promotionCode ? { promotionCode: request.promotionCode } : {}),
          ...(referralCouponId ? { referralCouponId } : {}),
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

  readonly createCustomServerCheckout = Effect.fn("BillingService.createCustomServerCheckout")(
    function* (
      this: BillingService,
      request: CustomServerCheckoutRequest,
    ): Effect.fn.Return<{ sessionId: string; url: string }, BillingError | BillingOperationError, BillingDependencies> {
      const dependencies = yield* BillingDependencies;
      yield* this.license.assertCurrency(request.user.id, request.plan.currency);
      const customerId = yield* this.ensureCustomer(request.user);
      const tax = yield* checkoutTax(dependencies.stripe, customerId, this.#countryRequired);
      const returnUrl = customServerReturnUrl(request.origin, request.target);
      const session = yield* this.#stripeCall(() =>
        dependencies.stripe.createCheckoutSession({
          customerId,
          inlinePrice: {
            productName: `OpenBot ${request.plan.name}`,
            amount: request.plan.amount,
            interval: request.plan.interval,
          },
          currency: request.plan.currency,
          userId: request.user.id,
          serverId: request.serverId,
          tax,
          metadata: {
            [LICENSE_METADATA.kind]: CUSTOM_SERVER_METADATA_KIND,
            ...(request.earlyStartAt === undefined
              ? {}
              : { [EARLY_START_METADATA]: new Date(request.earlyStartAt).toISOString() }),
          },
          successUrl: returnUrl,
          cancelUrl: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}cancelled=1`,
          nowSeconds: Math.floor(dependencies.now() / 1_000),
        }),
      );
      return { sessionId: session.id, url: session.url };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

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
        const earlyStartAt = Date.parse(session.metadata[EARLY_START_METADATA] ?? "");
        return {
          status: "closed",
          license: license && userId && !(yield* this.license.hasLicense(userId)) ? license : null,
          earlyStartAt: Number.isFinite(earlyStartAt) ? earlyStartAt : null,
        };
      }
      const subscriptionId = session.subscription;
      if (subscriptionId) {
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

  readonly subscriptionEnded = Effect.fn("BillingService.subscriptionEnded")(
    function* (
      this: BillingService,
      subscriptionId: string,
    ): Effect.fn.Return<boolean, BillingError | BillingOperationError, BillingDependencies> {
      const dependencies = yield* BillingDependencies;
      const subscription = yield* this.#stripeCall(() => dependencies.stripe.getSubscription(subscriptionId));
      const ended = subscription.status === "canceled" || subscription.status === "incomplete_expired";
      yield* this.#syncSubscription(subscriptionId);
      return ended;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

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
      yield* billingCall(() =>
        dependencies.database
          .prepare(
            `UPDATE billing_subscriptions SET status = 'canceled', cancel_at_period_end = 0, updated_at = ?
         WHERE stripe_subscription_id = ?`,
          )
          .bind(dependencies.now(), subscriptionId)
          .run(),
      );
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
                  s.amount, s.status, s.current_period_end, s.cancel_at_period_end,
                  hs.operator_host IS NOT NULL AS on_operator_host,
                  COALESCE(hs.storage_tier, 0) AS storage_tier
           FROM billing_subscriptions s
           LEFT JOIN remote_hosts h ON h.host_id = s.server_id AND ${subscriptionPaysForOwnerSql("s", "h.owner_user_id")}
           LEFT JOIN hosted_servers hs ON hs.server_id = s.server_id AND hs.owner_user_id = s.user_id
           WHERE s.user_id = ? AND s.status IN ${OPEN_STATUSES_SQL}
           ORDER BY h.name IS NULL, h.name COLLATE NOCASE, s.updated_at DESC`,
              )
              .bind(userId)
              .all<ServerPlanRow>(),
          ),
        ],
        { concurrency: "unbounded" },
      );
      const prices = rows.results.some((row) => canBuyStorage(row) && storageTierOf(row.storage_tier) < 2)
        ? yield* this.#prices().pipe(Effect.catch(() => Effect.succeed(NO_PRICES)))
        : NO_PRICES;
      const servers = rows.results.flatMap((row) => {
        const server = serverPlan(row, prices);
        return server ? [server] : [];
      });
      return { available: true, hasCustomer: customer !== null, servers };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

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
      if (request.flow === "manage" || request.flow === "update") {
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
      return yield* this.#stripeCall(() =>
        dependencies.stripe.createPortalSession({
          customerId,
          returnUrl,
          flow: { type: "subscription_cancel", subscriptionId: request.subscriptionId },
        }),
      );
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly buyStorage = Effect.fn("BillingService.buyStorage")(
    function* (
      this: BillingService,
      userId: string,
      request: BillingStorageRequest,
    ): Effect.fn.Return<BillingState, BillingError | BillingOperationError, BillingDependencies> {
      const dependencies = yield* BillingDependencies;
      const customerId = yield* this.#customerId(userId);
      if (!customerId) return yield* storageUnavailable();
      const owned = yield* billingCall(() =>
        dependencies.database
          .prepare(
            `SELECT s.server_id FROM billing_subscriptions s
         JOIN hosted_servers hs ON hs.server_id = s.server_id AND hs.owner_user_id = s.user_id
         WHERE s.stripe_subscription_id = ? AND s.user_id = ? AND s.stripe_customer_id = ?
           AND s.status = 'active' AND s.cancel_at_period_end = 0
           AND hs.operator_host IS NOT NULL AND hs.desired_state <> 'deleted' AND COALESCE(hs.storage_tier, 0) < ?`,
          )
          .bind(request.subscriptionId, userId, customerId, request.tier)
          .first<{ server_id: string }>(),
      );
      if (!owned) return yield* storageUnavailable();
      const current = yield* this.#stripeCall(() => dependencies.stripe.getSubscription(request.subscriptionId));
      const serverItem = subscriptionServerItem(current);
      const key = serverItem ? planLookupKey(serverItem.price) : null;
      const currency = current.currency.toLowerCase();
      if (
        !key ||
        !isBillingCurrency(currency) ||
        current.status !== "active" ||
        current.cancel_at_period_end ||
        typeof current.cancel_at === "number" ||
        subscriptionCustomerId(current) !== customerId ||
        current.metadata[BILLING_METADATA.serverId] !== owned.server_id ||
        subscriptionStorageTier(current) >= request.tier
      ) {
        return yield* storageUnavailable();
      }
      const price = (yield* this.#prices()).get(storageTierLookupKey(key.plan, request.tier, key.interval));
      if (!price || !priceHasCurrency(price, currency)) return yield* storageUnavailable();
      const storageItem = subscriptionStorageItem(current);
      const window = Math.floor(dependencies.now() / STORAGE_PURCHASE_WINDOW_MS);
      const paymentMethod = subscriptionPaymentMethodId(current) ?? "default";
      const idempotencyKey = `openbot-storage-${current.id}-${storageItem?.price.id ?? "none"}-${paymentMethod}-${window}`;
      yield* stripeRequest(() =>
        dependencies.stripe.setStorageItem(
          { subscriptionId: current.id, itemId: storageItem?.id ?? null, priceId: price.id },
          idempotencyKey,
        ),
      ).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            if (!(error instanceof StripeRequestError)) {
              const after = yield* stripeRequest(() => dependencies.stripe.getSubscription(current.id)).pipe(
                Effect.mapError(stripeFailure),
              );
              if (subscriptionStorageItem(after)?.price.id === price.id) return after;
            }
            if (error instanceof StripeRequestError && error.type === "idempotency_error") {
              return yield* storageUnavailable();
            }
            return yield* Effect.fail(
              error instanceof StripeRequestError && error.status === 402
                ? new BillingError(402, "storage_payment_failed", sourceText("error.billing.storagePaymentFailed"))
                : stripeFailure(error),
            );
          }),
        ),
      );
      yield* this.#syncSubscription(current.id);
      return yield* this.getState(userId);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

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
      yield* this.credits.webhook(event);
      if (isCreditCheckoutEvent(event)) return yield* this.#recordEvent(event, now);
      if (isCreditInvoiceEvent(event)) {
        if (this.#oss) yield* this.#oss.record(event);
        return yield* this.#recordEvent(event, now);
      }
      const reversal = paymentReversal(event);
      const payment = reversal
        ? yield* this.#stripeCall(() => dependencies.stripe.getPaymentInvoice(reversal.paymentIntentId))
        : null;
      const subscriptionId = eventSubscriptionId(event) ?? payment?.subscriptionId ?? null;
      let synced = subscriptionId ? yield* this.#syncSubscription(subscriptionId) : null;
      if (reversal?.type === "payment_disputed" && payment && synced) {
        yield* this.cancelSubscription(payment.subscriptionId);
        synced = yield* this.#syncSubscription(payment.subscriptionId);
      }
      if (synced?.kind === "plan" && synced.ended && synced.serverId && dependencies.onServerRefunded) {
        const invoiceId = synced.latestInvoiceId;
        const refunded =
          reversal?.type === "payment_refunded" ||
          (reversal?.type === "payment_disputed" &&
            !isDisputeInquiry(event) &&
            synced.startedAt !== null &&
            event.created * 1_000 - synced.startedAt < DISPUTE_DELETES_SERVER_MS) ||
          (event.type === "customer.subscription.deleted" &&
            invoiceId !== null &&
            (yield* this.#stripeCall(() => dependencies.stripe.isInvoiceRefunded(invoiceId))));
        if (refunded)
          yield* dependencies
            .onServerRefunded({ userId: synced.userId, serverId: synced.serverId })
            .pipe(Effect.mapError((error) => (error instanceof BillingError ? error : new BillingOperationError({}))));
      }
      const failedInvoice = synced?.kind === "license" ? failedRenewalInvoice(event, synced.currency) : null;
      if (synced?.kind === "license" && failedInvoice) yield* this.license.paymentFailed(synced, failedInvoice);
      const sold: BillingSalesSynced | null =
        synced?.kind === "license"
          ? {
              product: "license",
              userId: synced.userId,
              users: synced.users,
              interval: synced.interval,
              currency: synced.currency,
            }
          : synced?.kind === "plan"
            ? synced
            : null;
      if (this.#sales) {
        yield* this.#sales.webhook(event, sold, payment).pipe(Effect.mapError(() => new BillingOperationError({})));
      }
      if (this.#oss) yield* this.#oss.record(event);
      yield* this.#referral.record(event, payment, sold?.userId ?? null);
      yield* this.#recordEvent(event, now);
      if (!this.#sales) yield* this.#trackEvent(event, synced?.kind === "custom_server" ? null : synced);
      const mismatch = event.type === "checkout.session.completed" ? checkoutCountryMismatch(event.data.object) : null;
      if (mismatch) {
        console.warn(`billing: ${mismatch}`);
        this.#onVatMismatch?.(mismatch);
      }
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly #recordEvent = Effect.fn("BillingService.recordEvent")(function* (
    event: StripeEvent,
    now: number,
  ): Effect.fn.Return<void, BillingError | BillingOperationError, BillingDependencies> {
    const dependencies = yield* BillingDependencies;
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
  });

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
      amount:
        currency === synced.currency && isBillingAmount(amount)
          ? withoutTax(amount, object.total, object.total_excluding_tax)
          : null,
    });
  });

  readonly #syncSubscription = Effect.fn("BillingService.syncSubscription")(function* (
    this: BillingService,
    subscriptionId: string,
  ): Effect.fn.Return<
    SyncedSubscription | LicenseSync | CustomServerSync | null,
    BillingError | BillingOperationError,
    BillingDependencies
  > {
    const dependencies = yield* BillingDependencies;
    const readAt = dependencies.now();
    const subscription = yield* this.#stripeCall(() => dependencies.stripe.getSubscription(subscriptionId));
    if (subscription.metadata[LICENSE_METADATA.kind] === CUSTOM_SERVER_METADATA_KIND) {
      yield* this.#syncCustomServer(subscription, readAt);
      return { kind: "custom_server" };
    }
    const customerId = subscriptionCustomerId(subscription);
    const price = subscriptionServerItem(subscription)?.price;
    if (!price && subscriptionLicenseItem(subscription)) {
      const ownerId = yield* this.#subscriptionOwner(subscription, customerId);
      if (!ownerId) return null;
      const synced = yield* this.license.sync(subscription, ownerId, readAt);
      const granted = yield* Effect.exit(
        new CreditGrants({ database: dependencies.database, now: dependencies.now }).issue(subscription.id),
      );
      if (Exit.isFailure(granted)) console.warn("billing: license credits wait for the next sweep", { subscriptionId });
      return synced;
    }
    const key = price ? planLookupKey(price) : null;
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
      serverId,
      ended: subscription.status === "canceled",
      startedAt: subscriptionStartedAt(subscription),
    };
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
    const reactivated = others
      ? others.some((row) => row.status === "canceled") &&
        !others.some((row) => isOneOf(BILLING_SUBSCRIPTION_STATUSES, row.status) && isOpenBillingStatus(row.status))
      : undefined;
    if (action) this.#trackChange(action, previous, current, reactivated);
    const event = purchaseEvent(action);
    if (event) {
      yield* reportPurchase(
        { database: dependencies.database, now: dependencies.now, send: this.#onPurchase },
        subscription.id,
        ownerId,
        {
          event,
          periodEnd: subscriptionEnd(subscription),
          cancelRequest: subscription.canceled_at ?? null,
          ...(event === "ended" ? { endReason: planEndReason(previous) } : {}),
          product: "server",
          plan: key.plan,
          interval: key.interval,
          currency,
          amount,
          trial: subscription.status === "trialing",
        },
      );
    }
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
        storageTier: subscriptionStorageTier(subscription),
      }).pipe(Effect.mapError((error) => (error instanceof BillingError ? error : new BillingOperationError({}))));
    }
    yield* finish;
    return synced;
  });

  readonly #syncCustomServer = Effect.fn("BillingService.syncCustomServer")(function* (
    subscription: StripeSubscription,
    readAt: number,
  ): Effect.fn.Return<void, BillingError | BillingOperationError, BillingDependencies> {
    const dependencies = yield* BillingDependencies;
    const metadataServerId = subscription.metadata[BILLING_METADATA.serverId];
    const serverId = metadataServerId && SERVER_ID_PATTERN.test(metadataServerId) ? metadataServerId : null;
    if (!serverId) {
      console.warn("billing: custom server subscription has no server", { subscriptionId: subscription.id });
      return;
    }
    const paid = CUSTOM_SERVER_PAID_STATUSES.map(() => "?").join(", ");
    const stored = yield* billingCall(() =>
      dependencies.database
        .prepare(
          `UPDATE custom_server_offers
              SET stripe_subscription_id = ?, subscription_status = ?, checkout_session_id = NULL, updated_at = ?
            WHERE host_id = ?
              AND (stripe_subscription_id IS NULL OR stripe_subscription_id = ?
                OR subscription_status IS NULL OR subscription_status NOT IN (${paid}))
              AND (stripe_subscription_id IS NOT ? OR subscription_status IS NOT ?)`,
        )
        .bind(
          subscription.id,
          subscription.status,
          readAt,
          serverId,
          subscription.id,
          ...CUSTOM_SERVER_PAID_STATUSES,
          subscription.id,
          subscription.status,
        )
        .run(),
    );
    if (stored.meta.changes !== 1) return;
    const changed = dependencies.onCustomServerChanged;
    if (changed) {
      yield* changed(serverId).pipe(
        Effect.mapError((error) => (error instanceof BillingError ? error : new BillingOperationError({}))),
      );
    }
  });

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
      BILLING_INTERVALS.flatMap((interval) => [
        billingLookupKey(plan, interval),
        ...BILLING_STORAGE_UPGRADE_TIERS.map((tier) => storageTierLookupKey(plan, tier, interval)),
      ]),
    );
    const list = yield* this.#stripeCall(() => dependencies.stripe.listPricesByLookupKeys(lookupKeys));
    const prices = new Map(list.flatMap((price) => (price.lookup_key ? [[price.lookup_key, price] as const] : [])));
    catalogCache.set(this.#secretKey, { expiresAt: now + CATALOG_TTL_MS, prices });
    return prices;
  });

  readonly #subscriptionOwner = Effect.fn("BillingService.subscriptionOwner")(function* (
    this: BillingService,
    subscription: StripeSubscription,
    customerId: string,
  ): Effect.fn.Return<string | null, BillingError | BillingOperationError, BillingDependencies> {
    const dependencies = yield* BillingDependencies;
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

function planEndReason(previous: StoredSubscription | null): PlanEndReason {
  return previous?.status === "past_due" || previous?.status === "unpaid" ? "unpaid" : "canceled";
}

function planLookupKey(price: {
  lookup_key: string | null;
  metadata: Readonly<Record<string, string>>;
}): { plan: BillingPlanId; interval: BillingInterval } | null {
  return (
    parseBillingLookupKey(price.lookup_key) ??
    parseBillingLookupKey(`openbot_${price.metadata.openbot_plan}_${price.metadata.openbot_interval}`)
  );
}

function canBuyStorage(row: ServerPlanRow): boolean {
  return row.on_operator_host === 1 && row.status === "active" && row.cancel_at_period_end !== 1;
}

function serverPlan(row: ServerPlanRow, prices: ReadonlyMap<string, StripePrice>): BillingServerPlan | null {
  if (
    !isOneOf(BILLING_PLAN_IDS, row.plan) ||
    !isOneOf(BILLING_INTERVALS, row.interval) ||
    !isBillingCurrency(row.currency) ||
    !(row.amount === null || isBillingAmount(row.amount)) ||
    !isOneOf(BILLING_SUBSCRIPTION_STATUSES, row.status)
  ) {
    return null;
  }
  const storageTier = storageTierOf(row.storage_tier);
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
    storageGb: storageTierGb(row.plan, storageTier),
    ...(canBuyStorage(row)
      ? { storageUpgrades: storageUpgrades(row.plan, row.interval, row.currency, storageTier, row.amount, prices) }
      : {}),
  };
}

function storageUpgrades(
  plan: BillingPlanId,
  interval: BillingInterval,
  currency: BillingCurrency,
  tier: BillingStorageTier,
  amount: number | null,
  prices: ReadonlyMap<string, StripePrice>,
): BillingStorageUpgrade[] {
  const addOnAmount = (upgrade: BillingStorageUpgradeTier): number | null =>
    priceAmount(prices.get(storageTierLookupKey(plan, upgrade, interval)), currency);
  const currentAddOn = tier === 0 ? 0 : addOnAmount(tier);
  const planAmount = amount !== null && currentAddOn !== null ? amount - currentAddOn : null;
  return BILLING_STORAGE_UPGRADE_TIERS.flatMap((upgrade): BillingStorageUpgrade[] => {
    const price = prices.get(storageTierLookupKey(plan, upgrade, interval));
    if (upgrade <= tier || !price || !priceHasCurrency(price, currency)) return [];
    const added = addOnAmount(upgrade);
    const total = planAmount !== null && added !== null ? planAmount + added : null;
    return [{ tier: upgrade, storageGb: storageTierGb(plan, upgrade), amount: isBillingAmount(total) ? total : null }];
  });
}

function priceAmount(price: StripePrice | undefined, currency: BillingCurrency): number | null {
  if (!price) return null;
  const amount = price.currency === currency ? price.unit_amount : price.currency_options?.[currency]?.unit_amount;
  return isBillingAmount(amount) ? amount : null;
}

function storageUnavailable(): BillingError {
  return new BillingError(409, "storage_unavailable", sourceText("error.billing.storageUnavailable"));
}

function plansUnavailable(): BillingError {
  return new BillingError(503, "plans_unavailable", "The plans are not available. Try again later.");
}

function checkoutReturnUrl(origin: string, target: BillingReturnTarget, serverId: string): string {
  if (target === "web") return `${origin}/app?hosting=checkout&hosted_server=${encodeURIComponent(serverId)}`;
  return `${origin}/billing/return?kind=plan`;
}

function customServerReturnUrl(origin: string, target: BillingReturnTarget): string {
  if (target === "web") return `${origin}/app?hosting=custom`;
  return `${origin}/billing/return?kind=plan`;
}

function portalReturnUrl(origin: string, target: BillingReturnTarget): string {
  if (target === "web") return `${origin}/app?billing=portal`;
  return `${origin}/billing/return?kind=portal`;
}

function isLicenseCheckout(event: StripeEvent): boolean {
  if (!event.type.startsWith("checkout.session.")) return false;
  const metadata = event.data.object.metadata;
  return isDynamicRecord(metadata) && metadata[LICENSE_METADATA.kind] === LICENSE_METADATA_KIND;
}

function failedRenewalInvoice(event: StripeEvent, currency: BillingCurrency): FailedLicenseInvoice | null {
  if (event.type !== "invoice.payment_failed") return null;
  const object = event.data.object;
  const amountDue = object.amount_due;
  if (
    object.billing_reason !== "subscription_cycle" ||
    object.attempt_count !== 1 ||
    !isString(object.id) ||
    !isBillingAmount(amountDue) ||
    !isString(object.currency) ||
    object.currency.toLowerCase() !== currency
  ) {
    return null;
  }
  const nextAttempt = object.next_payment_attempt;
  return {
    invoiceId: object.id,
    amountDue,
    nextAttemptAt: typeof nextAttempt === "number" && Number.isSafeInteger(nextAttempt) ? nextAttempt * 1000 : null,
    invoiceUrl: stripeInvoiceUrl(object.hosted_invoice_url),
  };
}

function stripeInvoiceUrl(value: unknown): string | null {
  if (!isString(value) || !URL.canParse(value)) return null;
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "invoice.stripe.com" ? url.href : null;
}

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
      const details = isDynamicRecord(object.parent) ? object.parent.subscription_details : null;
      return isDynamicRecord(details) && isString(details.subscription) ? details.subscription : null;
    }
    default:
      return null;
  }
}
