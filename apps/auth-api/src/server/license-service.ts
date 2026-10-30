import {
  BILLING_INTERVALS,
  BILLING_METADATA,
  BILLING_SUBSCRIPTION_STATUSES,
  type BillingCurrency,
  type BillingInterval,
  type BillingSubscriptionStatus,
  isOpenBillingStatus,
} from "@openbot/contracts/billing";
import {
  LICENSE_INCLUDED_USERS,
  LICENSE_LOOKUP_KEYS,
  LICENSE_MAX_USERS,
  LICENSE_METADATA,
  LICENSE_METADATA_KIND,
  LICENSE_PLANS,
  LICENSE_TIERS,
  type License,
  type LicenseCheckoutRequest,
  type LicenseCoverage,
  type LicensePlan,
  type LicensePlanRequest,
  type LicenseState,
  type LicenseUser,
  licenseLookupKey,
  licenseMonthlyAmount,
  licensePeriodAmount,
  licensePlanFromPrice,
  ORDER_METADATA,
} from "@openbot/contracts/license";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Context, Effect, Layer } from "effect";
import {
  type AccountAnalytics,
  type BillingAction,
  NO_ACCOUNT_ANALYTICS,
  type PlanChangeDirection,
  type PlanEndReason,
} from "./account-analytics";
import { accountHasServerPlan, licenseEntitled } from "./billing-entitlement";
import {
  BillingError,
  BillingOperationError,
  billingCall,
  OPEN_STATUSES_SQL,
  stripeFailure,
  stripeRequest,
} from "./billing-errors";
import type { BillingSales } from "./billing-sales";
import type { RemoteFailure } from "./remote-control-plane";
import {
  isBillingCurrency,
  isLicensePrice,
  type StripeClient,
  type StripePrice,
  StripeRequestError,
  type StripeSubscription,
  type StripeTransportError,
  subscriptionCustomerId,
  subscriptionLatestInvoiceId,
  subscriptionLicenseItem,
  subscriptionPaymentMethodId,
  subscriptionPeriodEnd,
  subscriptionServerItem,
} from "./stripe-client";

/** Prices change only when `stripe-bootstrap.ts` runs, so each isolate reads the price once in this time. */
const PRICE_TTL_MS = 5 * 60_000;
const priceCache = new Map<string, { expiresAt: number; prices: ReadonlyMap<string, StripePrice> }>();

/** Where the Stripe page sends the user back: the desktop return page or the web client. */
export type LicenseReturnTarget = "desktop" | "web";

/** A license subscription that a sync stored. */
export interface LicenseSync {
  kind: "license";
  userId: string;
  latestInvoiceId: string | null;
  users: number;
  interval: BillingInterval;
  currency: BillingCurrency;
}

/** The stored state of a license before a sync writes it. */
interface StoredLicense {
  users: number;
  status: string;
  current_period_end: number | null;
  cancel_at_period_end: number;
  tier: string | null;
  billing_interval: string | null;
  bundle: number;
  updated_at: number;
}

interface LicenseRow {
  stripe_subscription_id: string;
  users: number;
  currency: string;
  status: string;
  current_period_end: number | null;
  cancel_at_period_end: number;
  tier: string | null;
  billing_interval: string | null;
  bundle: number;
}

const LICENSE_ROW_COLUMNS =
  "stripe_subscription_id, users, currency, status, current_period_end, cancel_at_period_end, tier, billing_interval, bundle";

interface LicenseUserRow {
  id: string;
  name: string | null;
  email: string;
  server_name: string | null;
}

export interface LicenseServiceOptions {
  database: D1Database;
  stripe: StripeClient;
  secretKey: string;
  /** A license bought before this time is free until then, in milliseconds since the epoch. */
  trialEnd?: number | null;
  now: () => number;
  /** The Stripe customer of the account. Server plans and the license use the same customer. */
  ensureCustomer: (user: { id: string; email: string }) => Effect.Effect<string, BillingError | BillingOperationError>;
  /** Reports the lifecycle of a license. The sync reports each stored change once. */
  analytics?: AccountAnalytics;
  /** The sales ledger. Without it, a started Checkout goes to `analytics`. */
  sales?: BillingSales | null;
  /**
   * Runs after a sync stores a license that opened or closed, has other users, or started or stopped
   * giving its users since its last write. The member limit of the owner's servers follows the license.
   * A failure is logged and does not fail the sync.
   */
  onLicenseChanged?: (userId: string) => Effect.Effect<void, RemoteFailure>;
}

class LicenseDependencies extends Context.Service<
  LicenseDependencies,
  { database: D1Database; stripe: StripeClient; now: () => number }
>()("auth-api/LicenseService/Dependencies") {}

/**
 * The commercial license of an account: one subscription whose quantity is the number of users. Its
 * Price gives the tier and the interval (`LICENSE_PLANS`). It uses its own table, so the server plans,
 * their member limits and the released routes do not change.
 */
export class LicenseService {
  readonly #layer: Layer.Layer<LicenseDependencies>;
  readonly #secretKey: string;
  readonly #ensureCustomer: LicenseServiceOptions["ensureCustomer"];
  readonly #analytics: AccountAnalytics;
  readonly #sales: BillingSales | null;
  readonly #trialEnd: number | null;
  readonly #now: () => number;
  readonly #onLicenseChanged: LicenseServiceOptions["onLicenseChanged"] | null;

  constructor(options: LicenseServiceOptions) {
    this.#secretKey = options.secretKey;
    this.#trialEnd = options.trialEnd ?? null;
    this.#now = options.now;
    this.#ensureCustomer = options.ensureCustomer;
    this.#analytics = options.analytics ?? NO_ACCOUNT_ANALYTICS;
    this.#sales = options.sales ?? null;
    this.#onLicenseChanged = options.onLicenseChanged ?? null;
    this.#layer = Layer.succeed(LicenseDependencies, {
      database: options.database,
      stripe: options.stripe,
      now: options.now,
    });
  }

  /**
   * The end of the free trial of a license bought now, in milliseconds since the epoch. Null when a new
   * license is paid at once. Stripe Checkout refuses a trial that ends less than 48 hours after it.
   */
  trialEnd(): number | null {
    return this.#trialEnd !== null && this.#trialEnd - this.#now() >= LICENSE_TRIAL_MARGIN_MS ? this.#trialEnd : null;
  }

  /**
   * The license of the account, the people that it counts, and the licenses of other owners that cover
   * this account. People count: the owner and each account that is an active member of a server that the
   * owner owns. AI agents and chat-app participants have no membership, so they do not count.
   */
  readonly getState = Effect.fn("LicenseService.getState")(
    function* (
      this: LicenseService,
      userId: string,
    ): Effect.fn.Return<LicenseState, BillingError | BillingOperationError, LicenseDependencies> {
      const dependencies = yield* LicenseDependencies;
      const [license, currency, userRows, coveredBy, bundle] = yield* Effect.all(
        [
          this.#latestLicense(userId),
          this.#lockedCurrency(userId),
          billingCall(() =>
            dependencies.database
              .prepare(
                `SELECT u.id, u.name, u.email, NULL AS server_name FROM users u WHERE u.id = ?1
                 UNION ALL
                 SELECT u.id, u.name, u.email, h.name AS server_name
                   FROM remote_hosts h
                   JOIN remote_memberships m ON m.host_id = h.host_id AND m.status = 'active'
                   JOIN users u ON u.id = m.user_id
                  WHERE h.owner_user_id = ?1 AND m.user_id <> ?1
                  ORDER BY server_name COLLATE NOCASE`,
              )
              .bind(userId)
              .all<LicenseUserRow>(),
          ),
          billingCall(() =>
            dependencies.database
              .prepare(
                `SELECT DISTINCT o.name AS owner_name, o.email AS owner_email
                   FROM remote_memberships m
                   JOIN remote_hosts h ON h.host_id = m.host_id AND h.owner_user_id <> ?1
                   JOIN licenses l ON l.user_id = h.owner_user_id AND l.status IN ${OPEN_STATUSES_SQL}
                   JOIN users o ON o.id = h.owner_user_id
                  WHERE m.user_id = ?1 AND m.status = 'active'
                  ORDER BY o.name COLLATE NOCASE, o.email`,
              )
              .bind(userId)
              .all<{ owner_name: string | null; owner_email: string }>(),
          ),
          this.#bundle(userId),
        ],
        { concurrency: "unbounded" },
      );
      const users = licenseUsers(userId, userRows.results);
      const trialEnd = this.trialEnd();
      return {
        // Sales pause when the Stripe price is archived. The section still shows, and checkout then
        // tells the user whom to contact.
        available: true,
        currency,
        license: license ? licenseFromRow(license) : null,
        used: users.length,
        users,
        coveredBy: coveredBy.results.map(
          (row): LicenseCoverage => ({ ownerName: row.owner_name, ownerEmail: row.owner_email }),
        ),
        bundle,
        ...(trialEnd === null ? {} : { trialEnd }),
      };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * A Stripe Checkout page for a new license. An account has one open license and one open license page.
   * Two requests at the same time keep the newer page and both return it. Stripe is the source of truth:
   * a page paid before its webhook, or a page paid while this request runs, stops the new page.
   * An account that pays for a hosted server buys the bundle price. During a promotion the license is
   * free until `trialEnd()`.
   */
  readonly createCheckout = Effect.fn("LicenseService.createCheckout")(
    function* (
      this: LicenseService,
      user: { id: string; email: string },
      request: Required<LicenseCheckoutRequest>,
      target: LicenseReturnTarget,
      origin: string,
    ): Effect.fn.Return<string, BillingError | BillingOperationError, LicenseDependencies> {
      const dependencies = yield* LicenseDependencies;
      const plan: LicensePlan = {
        tier: request.tier,
        interval: request.interval,
        bundle: yield* this.#bundle(user.id),
      };
      const price = yield* this.#price(plan);
      if (!price) return yield* licenseUnavailable();
      if (yield* this.#openLicense(user.id)) return yield* licenseExists();
      // The account service refuses a join above the license, so a license cannot start below the
      // people that it counts now.
      const { used } = yield* this.getState(user.id);
      if (request.users < used)
        return yield* new BillingError(409, "license_users_in_use", sourceText("error.billing.licenseUsersInUse"));
      // A Stripe customer pays all its subscriptions in one currency.
      const locked = yield* this.#lockedCurrency(user.id);
      if (locked && locked !== request.currency)
        return yield* new BillingError(409, "license_currency", sourceText("error.billing.licenseCurrency"));
      const customerId = yield* this.#ensureCustomer(user);
      const returnUrl = licenseReturnUrl(origin, target);
      const trialEnd = this.trialEnd();
      const session = yield* this.#stripeCall(() =>
        dependencies.stripe.createCheckoutSession({
          customerId,
          priceId: price.id,
          currency: request.currency,
          userId: user.id,
          quantity: request.users,
          metadata: licenseMetadata(plan),
          ...(trialEnd === null ? {} : { trialEndSeconds: Math.floor(trialEnd / 1_000) }),
          successUrl: returnUrl,
          cancelUrl: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}cancelled=1`,
          nowSeconds: Math.floor(dependencies.now() / 1_000),
        }),
      );
      const listed = yield* this.#stripeCall(() => dependencies.stripe.listOpenCheckoutSessions(customerId));
      const pages = listed.filter((page) => sellsLicense(page) && page.url !== null);
      // The list can be read before Stripe shows the new page in it.
      if (!pages.some((page) => page.id === session.id))
        pages.push({ ...session, status: "open", created: Math.floor(dependencies.now() / 1_000), metadata: {} });
      pages.sort((left, right) => right.created - left.created || right.id.localeCompare(left.id));
      const [kept = session, ...older] = pages;
      // A newer server order page sells the license. The loop below closes this page.
      const ordered = pages[0] !== undefined && pages[0].metadata[LICENSE_METADATA.kind] !== LICENSE_METADATA_KIND;
      let paid = false;
      for (const page of older) {
        const closed = yield* this.#stripeCall(() => dependencies.stripe.expireCheckoutSession(page.id));
        if (closed.status === "complete") paid = true;
      }
      // Read after the older pages closed, so that a page paid before they closed shows here.
      const readAt = dependencies.now();
      const subscriptions = yield* this.#stripeCall(() => dependencies.stripe.listCustomerSubscriptions(customerId));
      const open = subscriptions.find(
        (subscription) =>
          isOneOf(BILLING_SUBSCRIPTION_STATUSES, subscription.status) &&
          isOpenBillingStatus(subscription.status) &&
          (subscription.items.data.some((item) => isLicensePrice(item.price)) || orderedLicense(subscription) !== null),
      );
      if (open && !subscriptionServerItem(open)) yield* this.sync(open, user.id, readAt);
      if (paid || open) {
        yield* this.#stripeCall(() => dependencies.stripe.expireCheckoutSession(kept.id));
        return yield* licenseExists();
      }
      if (kept.id !== session.id && ordered) return yield* licenseExists();
      // Each page starts once: a request that returns a newer page of another request reports nothing.
      if (kept.id === session.id)
        yield* this.#checkoutStarted(user.id, session.id, plan, request.users, request.currency);
      return kept.url ?? session.url;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Changes the number of users. More users are invoiced now for the rest of the period, and the change
   * fails when that payment fails. Fewer users apply from the next invoice, with no refund. The license
   * cannot go below the people that it counts now.
   */
  readonly setUsers = Effect.fn("LicenseService.setUsers")(
    function* (
      this: LicenseService,
      userId: string,
      users: number,
    ): Effect.fn.Return<LicenseState, BillingError | BillingOperationError, LicenseDependencies> {
      const dependencies = yield* LicenseDependencies;
      const license = yield* this.#openLicense(userId);
      if (!license) return yield* noLicense();
      if (rowPlan(license).tier !== "team") return yield* licenseOneUser();
      const state = yield* this.getState(userId);
      if (users < Math.max(LICENSE_INCLUDED_USERS, state.used) || users > LICENSE_MAX_USERS)
        return yield* new BillingError(409, "license_users_in_use", sourceText("error.billing.licenseUsersInUse"));
      if (users === license.users) return state;
      const current = yield* this.#stripeCall(() =>
        dependencies.stripe.getSubscription(license.stripe_subscription_id),
      );
      const item = subscriptionLicenseItem(current);
      if (!item) return yield* noLicense();
      if (licensePlanFromPrice(item.price).tier !== "team") return yield* licenseOneUser();
      const quantity = item.quantity ?? 1;
      // Fewer users apply with no refund, so the users that this period already paid for stay paid. Only
      // users above that count are invoiced now.
      const periodEnd = String(subscriptionPeriodEnd(current) ?? "");
      const paidUsers = Number(current.metadata[LICENSE_METADATA.paidUsers]);
      const paid =
        current.metadata[LICENSE_METADATA.paidPeriodEnd] === periodEnd && Number.isSafeInteger(paidUsers)
          ? Math.max(quantity, paidUsers)
          : quantity;
      // Each write gets the time after Stripe answers: the webhook of an earlier write in this change can
      // read Stripe after this change started, and its older state must not replace this one.
      const setQuantity = (next: number, proration: "always_invoice" | "none") =>
        stripeRequest(() =>
          dependencies.stripe.setSubscriptionQuantity({
            subscriptionId: current.id,
            itemId: item.id,
            quantity: next,
            proration,
            metadata: {
              [LICENSE_METADATA.paidUsers]: String(Math.max(paid, proration === "always_invoice" ? next : 0)),
              [LICENSE_METADATA.paidPeriodEnd]: periodEnd,
            },
          }),
        ).pipe(Effect.map((updated) => ({ updated, readAt: dependencies.now() })));
      if (users <= paid) {
        const { updated, readAt } = yield* setQuantity(users, "none").pipe(Effect.mapError(stripeFailure));
        yield* this.sync(updated, userId, readAt);
        return yield* this.getState(userId);
      }
      // Stripe prorates from the current quantity, so the license first goes back to the paid users at no
      // charge. When the payment fails, Stripe keeps the paid users and the license goes back to as it was.
      if (quantity !== paid) yield* setQuantity(paid, "none").pipe(Effect.mapError(stripeFailure));
      const sync = (written: { updated: StripeSubscription; readAt: number }) =>
        this.sync(written.updated, userId, written.readAt);
      const { updated, readAt } = yield* setQuantity(users, "always_invoice").pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            // With no answer from Stripe, the increase can be applied and paid. Read it again, so that a paid
            // increase is kept and not charged a second time.
            if (!(error instanceof StripeRequestError)) {
              const readAt = dependencies.now();
              const after = yield* stripeRequest(() => dependencies.stripe.getSubscription(current.id)).pipe(
                Effect.mapError(stripeFailure),
              );
              if (subscriptionLicenseItem(after)?.quantity === users) return { updated: after, readAt };
            }
            if (quantity !== paid)
              yield* setQuantity(quantity, "none").pipe(
                Effect.flatMap(sync),
                Effect.catch(() =>
                  Effect.sync(() =>
                    console.warn("billing: license users were not restored", { subscriptionId: current.id }),
                  ),
                ),
              );
            return yield* Effect.fail(
              error instanceof StripeRequestError && error.status === 402
                ? new BillingError(402, "license_payment_failed", sourceText("error.billing.licensePaymentFailed"))
                : stripeFailure(error),
            );
          }),
        ),
      );
      yield* this.sync(updated, userId, readAt);
      return yield* this.getState(userId);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Moves an open license to a higher plan: a 1-user license to Team, or a monthly Team license to
   * yearly. Stripe invoices the prorated difference now and refuses the change when that payment fails.
   * A lower plan is not offered: the user cancels at the end of the period and buys again.
   */
  readonly changePlan = Effect.fn("LicenseService.changePlan")(
    function* (
      this: LicenseService,
      userId: string,
      request: LicensePlanRequest,
    ): Effect.fn.Return<LicenseState, BillingError | BillingOperationError, LicenseDependencies> {
      const dependencies = yield* LicenseDependencies;
      const license = yield* this.#openLicense(userId);
      if (!license) return yield* noLicense();
      const state = yield* this.getState(userId);
      if (request.users < Math.max(LICENSE_INCLUDED_USERS, state.used) || request.users > LICENSE_MAX_USERS)
        return yield* new BillingError(409, "license_users_in_use", sourceText("error.billing.licenseUsersInUse"));
      const current = yield* this.#stripeCall(() =>
        dependencies.stripe.getSubscription(license.stripe_subscription_id),
      );
      const item = subscriptionLicenseItem(current);
      if (!item) return yield* noLicense();
      const from = licensePlanFromPrice(item.price);
      // The new plan is invoiced now, so it takes the bundle price that the account has now.
      const to: LicensePlan = { tier: "team", interval: request.interval, bundle: yield* this.#bundle(userId) };
      if (!isUpgrade(from, to)) return yield* licensePlanChange();
      const price = yield* this.#price(to);
      if (!price) return yield* licenseUnavailable();
      const readAt = dependencies.now();
      const updated = yield* stripeRequest(() =>
        dependencies.stripe.setSubscriptionQuantity({
          subscriptionId: current.id,
          itemId: item.id,
          quantity: request.users,
          proration: "always_invoice",
          priceId: price.id,
          // The paid users of the old plan do not apply to the new one. An empty value removes the key.
          metadata: { [LICENSE_METADATA.paidUsers]: "", [LICENSE_METADATA.paidPeriodEnd]: "" },
        }),
      ).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            // With no answer from Stripe, the change can be applied and paid. Read it again, so that a
            // paid change is kept.
            if (!(error instanceof StripeRequestError)) {
              const after = yield* stripeRequest(() => dependencies.stripe.getSubscription(current.id)).pipe(
                Effect.mapError(stripeFailure),
              );
              if (subscriptionLicenseItem(after)?.price.id === price.id) return after;
            }
            return yield* Effect.fail(
              error instanceof StripeRequestError && error.status === 402
                ? new BillingError(402, "license_payment_failed", sourceText("error.billing.licensePaymentFailed"))
                : stripeFailure(error),
            );
          }),
        ),
      );
      yield* this.sync(updated, userId, readAt);
      return yield* this.getState(userId);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Moves an open license to its bundle price when the account pays for a hosted server, and back to its
   * plain price when it stops. The tier, interval and users stay. The new price applies from the next
   * renewal, with no proration and no refund. A server plan sync calls it, so a failure is logged and does
   * not fail that sync.
   */
  readonly alignBundlePrice = Effect.fn("LicenseService.alignBundlePrice")(
    function* (this: LicenseService, userId: string): Effect.fn.Return<void, never, LicenseDependencies> {
      const self = this;
      yield* Effect.gen(function* () {
        const dependencies = yield* LicenseDependencies;
        const license = yield* self.#openLicense(userId);
        if (!license) return;
        const bundle = yield* self.#bundle(userId);
        if (rowPlan(license).bundle === bundle) return;
        const current = yield* self.#stripeCall(() =>
          dependencies.stripe.getSubscription(license.stripe_subscription_id),
        );
        const item = subscriptionLicenseItem(current);
        // A server order that is not split yet: the split moves the license first.
        if (!item || subscriptionServerItem(current)) return;
        const from = licensePlanFromPrice(item.price);
        const readAt = dependencies.now();
        if (from.bundle === bundle) {
          // The stored row is behind Stripe.
          yield* self.sync(current, userId, readAt);
          return;
        }
        const price = yield* self.#price({ ...from, bundle });
        if (!price) {
          console.warn("billing: license price is missing", { tier: from.tier, interval: from.interval, bundle });
          return;
        }
        const updated = yield* self.#stripeCall(() =>
          dependencies.stripe.setSubscriptionQuantity({
            subscriptionId: current.id,
            itemId: item.id,
            quantity: item.quantity ?? 1,
            proration: "none",
            priceId: price.id,
          }),
        );
        yield* self.sync(updated, userId, readAt);
      }).pipe(
        Effect.catch(() =>
          Effect.sync(() => console.warn("billing: license price was not aligned with the server plans")),
        ),
      );
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Moves the license of a paid server order to its own subscription. The order's one Checkout made one
   * subscription with a server item and a license item. The new subscription has the same customer, Price,
   * users and payment method, and renews on the same date with no charge before it. Then the license item
   * leaves the server subscription with no proration. During a promotion the order has no license item:
   * its metadata names the license, which is free until the trial end of the order. Then the metadata
   * leaves the server subscription. A failed step runs again on the next webhook: the idempotency key and
   * the `orderSubscription` metadata make the license only once.
   */
  readonly splitOrder = Effect.fn("LicenseService.splitOrder")(
    function* (
      this: LicenseService,
      subscription: StripeSubscription,
      ownerId: string,
    ): Effect.fn.Return<void, BillingError | BillingOperationError, LicenseDependencies> {
      const dependencies = yield* LicenseDependencies;
      const item = subscriptionLicenseItem(subscription);
      const ordered = item ? null : orderedLicense(subscription);
      if ((!item && !ordered) || !subscriptionServerItem(subscription) || subscription.status !== "active") return;
      const currency = subscription.currency.toLowerCase();
      const periodEnd = subscriptionPeriodEnd(subscription);
      const price = item
        ? item.price
        : ordered
          ? yield* this.#price({ tier: ordered.tier, interval: ordered.interval, bundle: true })
          : null;
      if (!isBillingCurrency(currency) || periodEnd === null || !price) {
        console.warn("billing: server order cannot be split", { subscriptionId: subscription.id });
        return;
      }
      // A late webhook can come after the trial end. Stripe then needs a trial end in the future.
      const nowSeconds = Math.floor(dependencies.now() / 1_000);
      const anchorSeconds = ordered
        ? Math.max(ordered.trialEndSeconds, nowSeconds + 3_600)
        : Math.floor(periodEnd / 1_000);
      const customerId = subscriptionCustomerId(subscription);
      const listed = yield* this.#stripeCall(() => dependencies.stripe.listCustomerSubscriptions(customerId));
      const readAt = dependencies.now();
      const license =
        listed.find((candidate) => candidate.metadata[LICENSE_METADATA.orderSubscription] === subscription.id) ??
        (yield* this.#stripeCall(() =>
          dependencies.stripe
            .createSubscription(
              {
                customerId,
                priceId: price.id,
                quantity: item ? (item.quantity ?? 1) : (ordered?.users ?? 1),
                currency,
                anchorSeconds,
                trial: ordered !== null,
                paymentMethodId: subscriptionPaymentMethodId(subscription),
                metadata: {
                  [BILLING_METADATA.userId]: ownerId,
                  ...licenseMetadata(licensePlanFromPrice(price)),
                  [LICENSE_METADATA.orderSubscription]: subscription.id,
                },
              },
              `license-split:${subscription.id}`,
            )
            .pipe(
              // `checkout.session.completed` and `invoice.paid` come at the same time. The webhook that
              // makes the license now also finishes the split.
              Effect.catchIf(
                (error) => error instanceof StripeRequestError && error.code === "idempotency_key_in_use",
                () => Effect.succeed(null),
              ),
            ),
        ));
      if (!license) return;
      if (item) yield* this.#stripeCall(() => dependencies.stripe.deleteSubscriptionItem(item.id));
      else
        yield* this.#stripeCall(() =>
          dependencies.stripe.setSubscriptionMetadata(
            subscription.id,
            Object.fromEntries(Object.values(ORDER_METADATA).map((key) => [key, ""])),
          ),
        );
      yield* this.sync(license, ownerId, readAt);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** The Price of a license plan, or null when the Stripe account has none. */
  readonly price = Effect.fn("LicenseService.planPrice")(
    function* (
      this: LicenseService,
      plan: LicensePlan,
    ): Effect.fn.Return<StripePrice | null, BillingError | BillingOperationError, LicenseDependencies> {
      return yield* this.#price(plan);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Fails when a server order cannot buy this license: the account has an open license, or the license
   * has fewer users than the people that it counts now, as a license checkout refuses. `keepOrderPage`
   * then checks Stripe after the page opens.
   */
  readonly assertCanOrder = Effect.fn("LicenseService.assertCanOrder")(
    function* (
      this: LicenseService,
      userId: string,
      users: number,
    ): Effect.fn.Return<void, BillingError | BillingOperationError, LicenseDependencies> {
      if (yield* this.hasLicense(userId)) return yield* licenseExists();
      const { used } = yield* this.getState(userId);
      if (users < used)
        return yield* new BillingError(409, "license_users_in_use", sourceText("error.billing.licenseUsersInUse"));
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Keeps one open Checkout page that sells a license, as the license checkout does: the newest. A server
   * order page closes the customer's older pages that sell a license, and then reads Stripe, so a page
   * paid before it closed, or a paid order that is not split yet, refuses the order. When a newer page
   * sells a license, the order page closes.
   */
  readonly keepOrderPage = Effect.fn("LicenseService.keepOrderPage")(
    function* (
      this: LicenseService,
      customerId: string,
      sessionId: string,
    ): Effect.fn.Return<void, BillingError | BillingOperationError, LicenseDependencies> {
      const dependencies = yield* LicenseDependencies;
      const listed = yield* this.#stripeCall(() => dependencies.stripe.listOpenCheckoutSessions(customerId));
      const created = listed.find((page) => page.id === sessionId)?.created ?? Math.floor(dependencies.now() / 1_000);
      let paid = false;
      let newer = false;
      for (const page of listed) {
        if (page.id === sessionId || !sellsLicense(page)) continue;
        // The same order as the license checkout: created, then id.
        if ((page.created - created || page.id.localeCompare(sessionId)) > 0) {
          newer = true;
          continue;
        }
        const closed = yield* this.#stripeCall(() => dependencies.stripe.expireCheckoutSession(page.id));
        if (closed.status === "complete") paid = true;
      }
      const subscriptions = yield* this.#stripeCall(() => dependencies.stripe.listCustomerSubscriptions(customerId));
      const open = subscriptions.some(
        (subscription) =>
          isOneOf(BILLING_SUBSCRIPTION_STATUSES, subscription.status) &&
          isOpenBillingStatus(subscription.status) &&
          ordersLicense(subscription),
      );
      if (!paid && !open && !newer) return;
      yield* this.#stripeCall(() => dependencies.stripe.expireCheckoutSession(sessionId));
      return yield* licenseExists();
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** Fails when the account's open plans use another currency. A Stripe customer pays in one currency. */
  readonly assertCurrency = Effect.fn("LicenseService.assertCurrency")(
    function* (
      this: LicenseService,
      userId: string,
      currency: BillingCurrency,
    ): Effect.fn.Return<void, BillingError | BillingOperationError, LicenseDependencies> {
      const locked = yield* this.#lockedCurrency(userId);
      if (locked && locked !== currency)
        return yield* new BillingError(409, "billing_currency", sourceText("error.billing.planCurrency"));
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** True when the account has an open license. */
  readonly hasLicense = Effect.fn("LicenseService.hasLicense")(
    function* (
      this: LicenseService,
      userId: string,
    ): Effect.fn.Return<boolean, BillingError | BillingOperationError, LicenseDependencies> {
      return (yield* this.#openLicense(userId)) !== null;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** Cancels the license at the end of its period, or renews it again. */
  readonly setRenewal = Effect.fn("LicenseService.setRenewal")(
    function* (
      this: LicenseService,
      userId: string,
      cancel: boolean,
    ): Effect.fn.Return<LicenseState, BillingError | BillingOperationError, LicenseDependencies> {
      const dependencies = yield* LicenseDependencies;
      const license = yield* this.#openLicense(userId);
      if (!license) return yield* noLicense();
      const readAt = dependencies.now();
      const updated = yield* this.#stripeCall(() =>
        dependencies.stripe.setRenewal(license.stripe_subscription_id, cancel),
      );
      yield* this.sync(updated, userId, readAt);
      return yield* this.getState(userId);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Stores a license subscription that the webhook or a change read from Stripe. Two reads of one
   * subscription can run at the same time, so the write of the older read is skipped.
   */
  readonly sync = Effect.fn("LicenseService.sync")(
    function* (
      this: LicenseService,
      subscription: StripeSubscription,
      ownerId: string,
      readAt: number,
    ): Effect.fn.Return<LicenseSync | null, BillingError | BillingOperationError, LicenseDependencies> {
      const dependencies = yield* LicenseDependencies;
      const currency = subscription.currency.toLowerCase();
      const item = subscriptionLicenseItem(subscription);
      const users = item?.quantity ?? 1;
      const plan: LicensePlan = item
        ? licensePlanFromPrice(item.price)
        : { tier: "team", interval: "month", bundle: false };
      if (
        // A server order before its split is a server plan. The split stores its license.
        subscriptionServerItem(subscription) ||
        !isBillingCurrency(currency) ||
        !isOneOf(BILLING_SUBSCRIPTION_STATUSES, subscription.status) ||
        !Number.isSafeInteger(users) ||
        users < 1
      ) {
        console.warn("billing: subscription is not an OpenBot license", { subscriptionId: subscription.id });
        return null;
      }
      const cancelAtPeriodEnd = subscription.cancel_at_period_end || typeof subscription.cancel_at === "number";
      const periodEnd = subscriptionPeriodEnd(subscription);
      // One transaction reads the state before the write, so each stored change is reported once.
      const [before, written] = yield* billingCall(() =>
        dependencies.database.batch<StoredLicense>([
          dependencies.database
            .prepare(
              "SELECT users, status, current_period_end, cancel_at_period_end, tier, billing_interval, bundle, updated_at FROM licenses WHERE stripe_subscription_id = ?",
            )
            .bind(subscription.id),
          dependencies.database
            .prepare(
              `INSERT INTO licenses(
               stripe_subscription_id, user_id, stripe_customer_id, users, currency, status, current_period_end,
               cancel_at_period_end, tier, billing_interval, bundle, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(stripe_subscription_id) DO UPDATE SET
               users = excluded.users,
               tier = excluded.tier,
               billing_interval = excluded.billing_interval,
               bundle = excluded.bundle,
               currency = excluded.currency,
               status = excluded.status,
               current_period_end = excluded.current_period_end,
               cancel_at_period_end = excluded.cancel_at_period_end,
               updated_at = excluded.updated_at
             WHERE excluded.updated_at >= licenses.updated_at`,
            )
            .bind(
              subscription.id,
              ownerId,
              subscriptionCustomerId(subscription),
              users,
              currency,
              subscription.status,
              periodEnd,
              cancelAtPeriodEnd ? 1 : 0,
              plan.tier,
              plan.interval,
              plan.bundle ? 1 : 0,
              readAt,
            ),
        ]),
      );
      const previous = before?.results[0] ?? null;
      const change =
        written?.meta.changes === 1
          ? licenseChange(previous, { users, status: subscription.status, cancelAtPeriodEnd, plan, currency })
          : null;
      // Checkout lets one account open one license. A second one comes only from the Dashboard or a payment
      // that no check could stop, and a person must refund it.
      const others = yield* billingCall(() =>
        dependencies.database
          .prepare(
            `SELECT stripe_subscription_id FROM licenses
             WHERE user_id = ? AND stripe_subscription_id <> ? AND status IN ${OPEN_STATUSES_SQL}`,
          )
          .bind(ownerId, subscription.id)
          .all<{ stripe_subscription_id: string }>(),
      );
      if (isOpenBillingStatus(subscription.status) && others.results.length > 0)
        console.warn("billing: an account has more than one open license", {
          subscriptionIds: [subscription.id, ...others.results.map((row) => row.stripe_subscription_id)],
        });
      if (change) {
        // A license that starts after every earlier license of the account ended. A failed read leaves
        // the property out: the license is already saved, so the event must not fail the sync.
        const reactivated =
          change.action !== "plan_started"
            ? undefined
            : others.results.length > 0
              ? false
              : yield* billingCall(() =>
                  dependencies.database
                    .prepare(
                      "SELECT 1 AS ended FROM licenses WHERE user_id = ? AND stripe_subscription_id <> ? AND status = 'canceled' LIMIT 1",
                    )
                    .bind(ownerId, subscription.id)
                    .first<{ ended: number }>(),
                ).pipe(
                  Effect.map(Boolean),
                  Effect.catch(() => Effect.succeed(undefined)),
                );
        this.#analytics.track(ownerId, {
          name: "billing_action",
          action: change.action,
          product: "license",
          users,
          interval: plan.interval,
          currency,
          amount: licensePeriodAmount(plan, users, currency),
          ...(change.direction ? { direction: change.direction } : {}),
          ...(reactivated === undefined ? {} : { reactivated }),
          ...(change.endReason ? { endReason: change.endReason } : {}),
        });
      }
      // A `past_due` license stops giving its users at its period end with no change to its row. The lapse
      // sweep reads it after that time, so the view at the previous write's time is the one to compare.
      if (
        this.#onLicenseChanged &&
        written?.meta.changes === 1 &&
        memberLimitView(previous, previous?.updated_at ?? readAt) !==
          memberLimitView({ users, status: subscription.status, current_period_end: periodEnd }, readAt)
      ) {
        // The license is stored, and a retry of this event finds no change. A failed notice does not fail
        // the sync: each client reads the new limit with its next server list.
        yield* this.#onLicenseChanged(ownerId).pipe(
          Effect.catch(() =>
            Effect.sync(() => {
              console.warn("billing: license change notice failed", { subscriptionId: subscription.id });
            }),
          ),
        );
      }
      return {
        kind: "license",
        userId: ownerId,
        latestInvoiceId: subscriptionLatestInvoiceId(subscription),
        users,
        interval: plan.interval,
        currency,
      };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** The account of a stored license, or null for a subscription that is not a stored license. */
  readonly storedOwner = Effect.fn("LicenseService.storedOwner")(
    function* (
      this: LicenseService,
      subscriptionId: string,
    ): Effect.fn.Return<string | null, BillingError | BillingOperationError, LicenseDependencies> {
      const dependencies = yield* LicenseDependencies;
      const row = yield* billingCall(() =>
        dependencies.database
          .prepare("SELECT user_id FROM licenses WHERE stripe_subscription_id = ?")
          .bind(subscriptionId)
          .first<{ user_id: string }>(),
      );
      return row?.user_id ?? null;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** The open licenses whose period ended before `before` and that no sync read since `readBefore`. */
  readonly lapsed = Effect.fn("LicenseService.lapsed")(
    function* (
      this: LicenseService,
      before: number,
      readBefore: number,
      limit: number,
    ): Effect.fn.Return<string[], BillingError | BillingOperationError, LicenseDependencies> {
      const dependencies = yield* LicenseDependencies;
      const rows = yield* billingCall(() =>
        dependencies.database
          .prepare(
            `SELECT stripe_subscription_id FROM licenses
             WHERE status IN ${OPEN_STATUSES_SQL} AND current_period_end < ? AND updated_at < ?
             ORDER BY updated_at LIMIT ?`,
          )
          .bind(before, readBefore, limit)
          .all<{ stripe_subscription_id: string }>(),
      );
      return rows.results.map((row) => row.stripe_subscription_id);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Records a started license Checkout. The page is already open, so a failed write is logged and does
   * not fail the request.
   */
  readonly #checkoutStarted = Effect.fn("LicenseService.checkoutStarted")(function* (
    this: LicenseService,
    userId: string,
    sessionId: string,
    plan: LicensePlan,
    users: number,
    currency: BillingCurrency,
  ): Effect.fn.Return<void, never, LicenseDependencies> {
    const dependencies = yield* LicenseDependencies;
    const amount = licensePeriodAmount(plan, users, currency);
    if (!this.#sales) {
      this.#analytics.track(userId, {
        name: "billing_action",
        action: "checkout_started",
        product: "license",
        users,
        interval: plan.interval,
        currency,
        amount,
      });
      return;
    }
    yield* this.#sales
      .licenseCheckout({
        sessionId,
        userId,
        users,
        interval: plan.interval,
        currency,
        amount,
        createdAt: dependencies.now(),
      })
      .pipe(Effect.catch(() => Effect.sync(() => console.warn("billing: license checkout fact was not saved"))));
  });

  readonly #openLicense = Effect.fn("LicenseService.openLicense")(function* (
    this: LicenseService,
    userId: string,
  ): Effect.fn.Return<LicenseRow | null, BillingError | BillingOperationError, LicenseDependencies> {
    const dependencies = yield* LicenseDependencies;
    return yield* billingCall(() =>
      dependencies.database
        .prepare(
          `SELECT ${LICENSE_ROW_COLUMNS}
           FROM licenses WHERE user_id = ? AND status IN ${OPEN_STATUSES_SQL} ORDER BY updated_at DESC LIMIT 1`,
        )
        .bind(userId)
        .first<LicenseRow>(),
    );
  });

  /** The open license, else the newest ended license. */
  readonly #latestLicense = Effect.fn("LicenseService.latestLicense")(function* (
    this: LicenseService,
    userId: string,
  ): Effect.fn.Return<LicenseRow | null, BillingError | BillingOperationError, LicenseDependencies> {
    const dependencies = yield* LicenseDependencies;
    return yield* billingCall(() =>
      dependencies.database
        .prepare(
          `SELECT ${LICENSE_ROW_COLUMNS}
           FROM licenses WHERE user_id = ?
           ORDER BY status IN ${OPEN_STATUSES_SQL} DESC, updated_at DESC LIMIT 1`,
        )
        .bind(userId)
        .first<LicenseRow>(),
    );
  });

  /** The currency of the account's open server plans and license, or null when it has none. */
  readonly #lockedCurrency = Effect.fn("LicenseService.lockedCurrency")(function* (
    this: LicenseService,
    userId: string,
  ): Effect.fn.Return<BillingCurrency | null, BillingError | BillingOperationError, LicenseDependencies> {
    const dependencies = yield* LicenseDependencies;
    const row = yield* billingCall(() =>
      dependencies.database
        .prepare(
          `SELECT currency FROM billing_subscriptions WHERE user_id = ?1 AND status IN ${OPEN_STATUSES_SQL}
           UNION ALL
           SELECT currency FROM licenses WHERE user_id = ?1 AND status IN ${OPEN_STATUSES_SQL}
           LIMIT 1`,
        )
        .bind(userId)
        .first<{ currency: string }>(),
    );
    return row && isBillingCurrency(row.currency) ? row.currency : null;
  });

  /**
   * The Price of a license plan, or null when the Stripe account has none. One read gets all the plans.
   * A Price whose metadata names another plan is not used, so a wrong lookup key cannot sell it.
   */
  readonly #price = Effect.fn("LicenseService.price")(function* (
    this: LicenseService,
    plan: LicensePlan,
  ): Effect.fn.Return<StripePrice | null, BillingError | BillingOperationError, LicenseDependencies> {
    const dependencies = yield* LicenseDependencies;
    const now = dependencies.now();
    const lookupKey = licenseLookupKey(plan);
    const cached = priceCache.get(this.#secretKey);
    if (cached && cached.expiresAt > now) return cached.prices.get(lookupKey) ?? null;
    const list = yield* this.#stripeCall(() => dependencies.stripe.listPricesByLookupKeys(LICENSE_LOOKUP_KEYS));
    const prices = new Map<string, StripePrice>();
    for (const price of list) {
      const listed = LICENSE_PLANS.find((candidate) => licenseLookupKey(candidate) === price.lookup_key);
      if (listed && samePlan(licensePlanFromPrice(price), listed)) prices.set(licenseLookupKey(listed), price);
      else console.warn("billing: license price metadata does not match its lookup key", { priceId: price.id });
    }
    priceCache.set(this.#secretKey, { expiresAt: now + PRICE_TTL_MS, prices });
    return prices.get(lookupKey) ?? null;
  });

  /** True when the account pays for a hosted server, so a license gets the bundle price. */
  readonly #bundle = Effect.fn("LicenseService.bundle")(function* (
    this: LicenseService,
    userId: string,
  ): Effect.fn.Return<boolean, BillingOperationError, LicenseDependencies> {
    const dependencies = yield* LicenseDependencies;
    return yield* accountHasServerPlan(dependencies.database, userId, dependencies.now()).pipe(
      Effect.mapError(() => new BillingOperationError({})),
    );
  });

  readonly #stripeCall = Effect.fn("LicenseService.stripeCall")(
    <T>(call: () => Effect.Effect<T, StripeRequestError | StripeTransportError>) =>
      stripeRequest(call).pipe(Effect.mapError(stripeFailure)),
  );
}

/** The owner first, then each other person once, with the names of the owner's servers where they are a member. */
function licenseUsers(ownerId: string, rows: readonly LicenseUserRow[]): LicenseUser[] {
  const users = new Map<string, LicenseUser>();
  for (const row of rows) {
    const user = users.get(row.id) ?? { name: row.name, email: row.email, servers: [], owner: row.id === ownerId };
    if (row.server_name !== null && !user.servers.includes(row.server_name)) user.servers.push(row.server_name);
    users.set(row.id, user);
  }
  return [...users.values()].sort((left, right) => Number(right.owner) - Number(left.owner));
}

/** The plan of a stored license. A license from before the tiers has none and is Team monthly. */
function rowPlan(row: { tier: string | null; billing_interval: string | null; bundle: number }): LicensePlan {
  return {
    tier: isOneOf(LICENSE_TIERS, row.tier) ? row.tier : "team",
    interval: isOneOf(BILLING_INTERVALS, row.billing_interval) ? row.billing_interval : "month",
    bundle: row.bundle === 1,
  };
}

function samePlan(left: LicensePlan, right: LicensePlan): boolean {
  return left.tier === right.tier && left.interval === right.interval && left.bundle === right.bundle;
}

/** The metadata of a license Checkout and subscription. */
function licenseMetadata(plan: LicensePlan): Record<string, string> {
  return {
    [LICENSE_METADATA.kind]: LICENSE_METADATA_KIND,
    [LICENSE_METADATA.tier]: plan.tier,
    [LICENSE_METADATA.interval]: plan.interval,
    [LICENSE_METADATA.bundle]: String(plan.bundle),
  };
}

/** The changes that the app sells: a 1-user license to Team, and a monthly Team license to yearly. */
function isUpgrade(from: LicensePlan, to: LicensePlan): boolean {
  if (to.tier !== "team") return false;
  // A yearly license does not go back to monthly: Stripe would credit the rest of the year.
  if (from.tier !== "team") return from.interval === "month" || to.interval === "year";
  return from.interval === "month" && to.interval === "year";
}

function licenseFromRow(row: LicenseRow): License | null {
  if (!isBillingCurrency(row.currency) || !isOneOf(BILLING_SUBSCRIPTION_STATUSES, row.status)) return null;
  const status: BillingSubscriptionStatus = row.status;
  const plan = rowPlan(row);
  return {
    subscriptionId: row.stripe_subscription_id,
    users: row.users,
    currency: row.currency,
    amount: licenseMonthlyAmount(plan, row.users, row.currency),
    tier: plan.tier,
    interval: plan.interval,
    bundle: plan.bundle,
    status,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end === 1 && isOpenBillingStatus(status),
  };
}

/**
 * The change of a license that one sync stored, with the same actions as a server plan. One sync reports
 * one action: a start or an end first, then a change of users, then a change of renewal.
 */
function licenseChange(
  previous: StoredLicense | null,
  current: {
    users: number;
    status: BillingSubscriptionStatus;
    cancelAtPeriodEnd: boolean;
    plan: LicensePlan;
    currency: BillingCurrency;
  },
): { action: BillingAction; direction?: PlanChangeDirection; endReason?: PlanEndReason } | null {
  const wasOpen =
    previous !== null &&
    isOneOf(BILLING_SUBSCRIPTION_STATUSES, previous.status) &&
    isOpenBillingStatus(previous.status);
  const isOpen = isOpenBillingStatus(current.status);
  if (!previous || !wasOpen) return isOpen ? { action: "plan_started" } : null;
  if (!isOpen)
    return {
      action: "plan_ended",
      endReason: previous.status === "past_due" || previous.status === "unpaid" ? "unpaid" : "canceled",
    };
  const previousPlan = rowPlan(previous);
  if (previous.users !== current.users || !samePlan(previousPlan, current.plan)) {
    const before = licenseMonthlyAmount(previousPlan, previous.users, current.currency);
    const after = licenseMonthlyAmount(current.plan, current.users, current.currency);
    // A move to yearly lowers the monthly amount but is an upgrade.
    const up = after > before || (previousPlan.interval === "month" && current.plan.interval === "year");
    return { action: "plan_changed", direction: up ? "up" : "down" };
  }
  const wasCancelling = previous.cancel_at_period_end === 1;
  if (wasCancelling === current.cancelAtPeriodEnd) return null;
  return { action: current.cancelAtPeriodEnd ? "cancel_scheduled" : "cancel_withdrawn" };
}

/**
 * The web client opens Billing again. The desktop app reads the license again, so its page only says to go back.
 * `kind` tells the return page which Stripe page closed.
 */
function licenseReturnUrl(origin: string, target: LicenseReturnTarget): string {
  if (target === "web") return `${origin}/app?billing=license`;
  return `${origin}/billing/return?kind=license`;
}

/** A trial sold with less time left than this would end before Stripe accepts it (48 hours). */
const LICENSE_TRIAL_MARGIN_MS = 49 * 60 * 60_000;

/** The free license that a paid server order of a promotion names in its metadata, or null. */
function orderedLicense(
  subscription: StripeSubscription,
): { tier: LicensePlan["tier"]; interval: BillingInterval; users: number; trialEndSeconds: number } | null {
  const metadata = subscription.metadata;
  const tier = metadata[ORDER_METADATA.licenseTier];
  const interval = metadata[ORDER_METADATA.licenseInterval];
  const users = Number(metadata[ORDER_METADATA.licenseUsers]);
  const trialEndSeconds = Number(metadata[ORDER_METADATA.licenseTrialEnd]);
  if (
    !isOneOf(LICENSE_TIERS, tier) ||
    !isOneOf(BILLING_INTERVALS, interval) ||
    !Number.isSafeInteger(users) ||
    users < 1 ||
    !Number.isSafeInteger(trialEndSeconds)
  )
    return null;
  return { tier, interval, users, trialEndSeconds };
}

/**
 * True for a server subscription whose license is not split yet: a license item, or the metadata of a
 * promotion order.
 */
export function ordersLicense(subscription: StripeSubscription): boolean {
  return subscriptionLicenseItem(subscription) !== null || orderedLicense(subscription) !== null;
}

/** A trial end from the Worker settings, as an ISO 8601 time. Null when it is empty or not a time. */
export function parseLicenseTrialEnd(value: string | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const time = Date.parse(trimmed);
  return Number.isFinite(time) ? time : null;
}

/** True for a Checkout page that sells a license: a license page, or a server order with a license. */
function sellsLicense(page: { metadata: Readonly<Record<string, string>> }): boolean {
  return (
    page.metadata[LICENSE_METADATA.kind] === LICENSE_METADATA_KIND ||
    page.metadata[ORDER_METADATA.licenseTier] !== undefined
  );
}

/**
 * What the member limit of the owner's servers reads from a license at one time: its users while it is
 * open, and if it gives them. A renewal changes none of these, so it tells no client.
 */
function memberLimitView(
  license: { users: number; status: string; current_period_end: number | null } | null,
  at: number,
): string {
  const status = license?.status;
  if (!license || !isOneOf(BILLING_SUBSCRIPTION_STATUSES, status) || !isOpenBillingStatus(status)) return "closed";
  return `${license.users}:${licenseEntitled(license, at)}`;
}

function licenseExists(): BillingError {
  return new BillingError(409, "license_exists", sourceText("error.billing.licenseExists"));
}

function licenseUnavailable(): BillingError {
  return new BillingError(503, "license_unavailable", sourceText("error.billing.licenseUnavailable"));
}

function licenseOneUser(): BillingError {
  return new BillingError(409, "license_one_user", sourceText("error.billing.licenseOneUser"));
}

function licensePlanChange(): BillingError {
  return new BillingError(409, "license_plan_change", sourceText("error.billing.licensePlanChange"));
}

function noLicense(): BillingError {
  return new BillingError(404, "no_license", sourceText("error.billing.noLicense"));
}
