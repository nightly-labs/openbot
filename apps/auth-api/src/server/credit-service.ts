import { BILLING_CURRENCIES, type BillingCurrency } from "@openbot/contracts/billing";
import {
  CREDIT_LOOKUP_KEYS,
  CREDIT_METADATA,
  CREDIT_METADATA_KIND,
  type CreditActivity,
  type CreditCheckoutRequest,
  type CreditServerRole,
  type CreditServerWallet,
  type CreditsState,
  type CreditTransferRequest,
  creditLookupKey,
  creditStop,
  creditsFromTenths,
  creditTenths,
} from "@openbot/contracts/credits";
import { isDynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Option, Schema } from "effect";
import { type AccountAnalytics, NO_ACCOUNT_ANALYTICS } from "./account-analytics";
import {
  BillingError,
  type BillingOperationError,
  billingCall,
  OPEN_STATUSES_SQL,
  stripeFailure,
  stripeRequest,
} from "./billing-errors";
import type { CreditPurchase } from "./billing-purchase";
import { paymentReversal } from "./billing-sales";
import { checkoutTax } from "./billing-tax";
import { creditActivity } from "./credit-activity";
import { CreditAudit, creditAuditCode } from "./credit-audit";
import { consumeGrantsSql, creditExpiring, expiringGrantsSql, moveGrantsSql } from "./credit-grants";
import { availableTenthsSql, overdueGrantTenthsSql } from "./credit-spending";
import {
  EARLY_START_METADATA,
  isBillingCurrency,
  priceHasCurrency,
  type StripeClient,
  type StripeEvent,
  type StripePrice,
  type StripeRequestError,
  type StripeTransportError,
} from "./stripe-client";

const PRICE_TTL_MS = 5 * 60 * 1_000;
const priceCache = new Map<string, { expiresAt: number; prices: ReadonlyMap<string, StripePrice> }>();
const SERVER_ROLES: readonly CreditServerRole[] = ["owner", "admin", "member"];
function movedGrantsSql(nowParam: string): string {
  return `SELECT ?1 AS user_id, ?2 AS server_id, ?3 AS tenths, ${nowParam} AS created_at
    WHERE EXISTS (SELECT 1 FROM credit_ledger WHERE entry_id = ?4)`;
}
function ownedServerSql(serverParam: string, userParam: string): string {
  return `EXISTS (
    SELECT 1 FROM remote_hosts h
      JOIN remote_memberships m ON m.host_id = h.host_id AND m.user_id = h.owner_user_id AND m.status = 'active'
     WHERE h.host_id = ${serverParam} AND h.owner_user_id = ${userParam}
  )`;
}

type Failure = BillingError | BillingOperationError;
type CreditReturnTarget = "desktop" | "web";

export interface CreditServiceOptions {
  database: D1Database;
  stripe: StripeClient;
  secretKey: string;
  countryRequired: boolean;
  now: () => number;
  ensureCustomer: (user: { id: string; email: string }) => Effect.Effect<string, Failure>;
  analytics?: AccountAnalytics;
  onPurchase?: (purchase: CreditPurchase) => void;
}

export interface CreditCheckoutInput {
  user: { id: string; email: string };
  request: CreditCheckoutRequest;
  target: CreditReturnTarget;
  origin: string;
}

interface ServerRow {
  server_id: string;
  name: string;
  role: string;
  balance_tenths: number;
  expiring_tenths: number;
  expiring_at: number | null;
}

interface WalletRow {
  balance_tenths: number;
  expiring_tenths: number;
  expiring_at: number | null;
}

interface PurchaseRow {
  user_id: string | null;
  server_id: string | null;
  buyer_id: string;
  credits: number;
  currency: string;
  amount: number | null;
}

interface ExpiredPurchaseRow {
  user_id: string;
  server_id: string | null;
  credits: number;
  currency: string;
}

interface CreditTarget {
  userId: string;
  serverId: string | null;
  credits: number;
}

function hasCreditMetadata(event: StripeEvent): boolean {
  const metadata = event.data.object.metadata;
  return isDynamicRecord(metadata) && metadata[CREDIT_METADATA.kind] === CREDIT_METADATA_KIND;
}

export function isCreditCheckoutEvent(event: StripeEvent): boolean {
  return event.type.startsWith("checkout.session.") && hasCreditMetadata(event);
}

export function isCreditInvoiceEvent(event: StripeEvent): boolean {
  return event.type.startsWith("invoice.") && hasCreditMetadata(event);
}

const creditSessionSchema = Schema.Struct({
  id: Schema.String,
  mode: Schema.optional(Schema.NullOr(Schema.String)),
  payment_status: Schema.optional(Schema.NullOr(Schema.String)),
  payment_intent: Schema.optional(Schema.NullOr(Schema.String)),
  amount_total: Schema.optional(Schema.NullOr(Schema.Int)),
  currency: Schema.optional(Schema.NullOr(Schema.String)),
  metadata: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.String))),
});
type CreditSession = typeof creditSessionSchema.Type;

function creditTarget(session: CreditSession): CreditTarget | null {
  const metadata = session.metadata ?? {};
  const userId = metadata[CREDIT_METADATA.userId];
  const serverId = metadata[CREDIT_METADATA.serverId];
  const credits = Number(metadata[CREDIT_METADATA.credits]);
  const currency = session.currency?.toLowerCase();
  if (!userId || !isBillingCurrency(currency) || !creditStop(credits, currency)) return null;
  return { userId, serverId: serverId || null, credits };
}

function walletColumn(serverId: string | null): "user_id" | "server_id" {
  return serverId === null ? "user_id" : "server_id";
}

function returnUrl(origin: string, target: CreditReturnTarget): string {
  if (target === "web") return `${origin}/app?billing=credits`;
  return `${origin}/billing/return?kind=credits`;
}

export class CreditService {
  readonly #database: D1Database;
  readonly #stripe: StripeClient;
  readonly #secretKey: string;
  readonly #countryRequired: boolean;
  readonly #now: () => number;
  readonly #ensureCustomer: CreditServiceOptions["ensureCustomer"];
  readonly #analytics: AccountAnalytics;
  readonly #audit: CreditAudit;
  readonly #onPurchase: ((purchase: CreditPurchase) => void) | null;

  constructor(options: CreditServiceOptions) {
    this.#database = options.database;
    this.#stripe = options.stripe;
    this.#secretKey = options.secretKey;
    this.#countryRequired = options.countryRequired;
    this.#now = options.now;
    this.#ensureCustomer = options.ensureCustomer;
    this.#analytics = options.analytics ?? NO_ACCOUNT_ANALYTICS;
    this.#audit = new CreditAudit(options.database, options.now);
    this.#onPurchase = options.onPurchase ?? null;
  }

  readonly getState = Effect.fn("CreditService.getState")(function* (
    this: CreditService,
    userId: string,
  ): Effect.fn.Return<CreditsState, Failure> {
    const locked = yield* this.#lockedCurrency(userId);
    const prices = yield* this.#prices().pipe(Effect.orElseSucceed(() => new Map<string, StripePrice>()));
    const currencies = BILLING_CURRENCIES.filter(
      (currency) =>
        (locked === null || currency === locked) &&
        CREDIT_LOOKUP_KEYS.every((key) => {
          const price = prices.get(key);
          return price !== undefined && priceHasCurrency(price, currency);
        }),
    );
    const currency = locked ?? (currencies.includes("eur") ? "eur" : (currencies[0] ?? "eur"));
    const now = this.#now();
    const personal = yield* billingCall(() =>
      this.#database
        .prepare(
          `SELECT ${availableTenthsSql("user_id", "?1")} AS balance_tenths, ${expiringGrantsSql("user_id", "?1", "?2")}`,
        )
        .bind(userId, now)
        .first<WalletRow>(),
    );
    const balanceTenths = Math.max(0, personal?.balance_tenths ?? 0);
    const rows = yield* billingCall(() =>
      this.#database
        .prepare(
          `SELECT h.host_id AS server_id, h.name AS name,
                  CASE WHEN h.owner_user_id = ?1 THEN 'owner' ELSE m.role END AS role,
                  ${availableTenthsSql("server_id", "h.host_id")} AS balance_tenths,
                  ${expiringGrantsSql("server_id", "h.host_id", "?2")}
             FROM remote_hosts h
             JOIN remote_memberships m ON m.host_id = h.host_id AND m.user_id = ?1 AND m.status = 'active'
            ORDER BY h.owner_user_id = ?1 DESC, h.name COLLATE NOCASE, h.host_id`,
        )
        .bind(userId, now)
        .all<ServerRow>(),
    );
    const servers: CreditServerWallet[] = rows.results.flatMap((row) => {
      if (!isOneOf(SERVER_ROLES, row.role)) return [];
      const walletTenths = Math.max(0, row.balance_tenths);
      const wallet: CreditServerWallet = {
        serverId: row.server_id,
        name: row.name,
        role: row.role,
        balance: creditsFromTenths(walletTenths),
      };
      const expiring = creditExpiring(row, walletTenths);
      if (expiring) wallet.expiring = expiring;
      return [wallet];
    });
    const state: CreditsState = {
      available: currencies.length > 0,
      currency,
      currencies,
      balance: creditsFromTenths(balanceTenths),
      servers,
    };
    const expiring = personal ? creditExpiring(personal, balanceTenths) : null;
    if (expiring) state.expiring = expiring;
    return state;
  }).bind(this);

  activity(userId: string): Effect.Effect<CreditActivity, Failure> {
    return creditActivity(this.#database, userId);
  }

  createCheckout(input: CreditCheckoutInput): Effect.Effect<{ url: string }, Failure> {
    const { user, request } = input;
    return this.#checkout(input).pipe(
      Effect.tapError((error) =>
        this.#audit.failed({
          event: "checkout",
          code: creditAuditCode(error),
          wallet: { userId: request.serverId === undefined ? user.id : null, serverId: request.serverId ?? null },
          actorUserId: user.id,
          ...(Number.isFinite(request.credits) && request.credits > 0 ? { credits: request.credits } : {}),
          detail: { currency: request.currency },
        }),
      ),
    );
  }

  readonly #checkout = Effect.fn("CreditService.createCheckout")(function* (
    this: CreditService,
    input: CreditCheckoutInput,
  ): Effect.fn.Return<{ url: string }, Failure> {
    const { user, request } = input;
    const stop = creditStop(request.credits, request.currency);
    if (!stop) return yield* unavailable();
    if (request.serverId !== undefined && !(yield* this.#isMember(user.id, request.serverId)))
      return yield* new BillingError(403, "credits_server_member", sourceText("error.billing.creditsServerMember"));
    const locked = yield* this.#lockedCurrency(user.id);
    if (locked !== null && locked !== request.currency)
      return yield* new BillingError(409, "credits_currency", sourceText("error.billing.creditsCurrency"));
    const price = (yield* this.#prices()).get(creditLookupKey(stop));
    if (!price || !priceHasCurrency(price, request.currency)) return yield* unavailable();
    const customerId = yield* this.#ensureCustomer(user);
    const tax = yield* checkoutTax(this.#stripe, customerId, this.#countryRequired);
    const url = returnUrl(input.origin, input.target);
    const now = this.#now();
    const metadata: Record<string, string> = {
      [CREDIT_METADATA.kind]: CREDIT_METADATA_KIND,
      [CREDIT_METADATA.userId]: user.id,
      [CREDIT_METADATA.credits]: String(stop.credits),
    };
    if (request.serverId !== undefined) metadata[CREDIT_METADATA.serverId] = request.serverId;
    if (request.earlyStart) metadata[EARLY_START_METADATA] = new Date(now).toISOString();
    const session = yield* this.#stripeCall(() =>
      this.#stripe.createPaymentCheckoutSession({
        customerId,
        priceId: price.id,
        currency: request.currency,
        clientReferenceId: request.serverId ?? user.id,
        metadata,
        tax,
        successUrl: url,
        cancelUrl: `${url}&cancelled=1`,
        nowSeconds: Math.floor(now / 1_000),
      }),
    );
    yield* billingCall(() =>
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO credit_purchases(
             checkout_session_id, user_id, server_id, credits, currency, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
        )
        .bind(session.id, user.id, request.serverId ?? null, stop.credits, request.currency, now, now)
        .run(),
    );
    this.#analytics.track(user.id, {
      name: "credit_action",
      action: "checkout_started",
      wallet: request.serverId === undefined ? "personal" : "server",
      credits: stop.credits,
      currency: request.currency,
      earlyStart: request.earlyStart === true,
    });
    return { url: session.url };
  }).bind(this);

  transfer(userId: string, request: CreditTransferRequest): Effect.Effect<CreditsState, Failure> {
    return this.#transfer(userId, request).pipe(
      Effect.tapError((error) =>
        this.#audit.failed({
          event: "transfer",
          code: creditAuditCode(error),
          wallet: { userId: null, serverId: request.serverId },
          actorUserId: userId,
          credits: request.credits,
          detail: { direction: request.direction },
        }),
      ),
    );
  }

  readonly #transfer = Effect.fn("CreditService.transfer")(function* (
    this: CreditService,
    userId: string,
    request: CreditTransferRequest,
  ): Effect.fn.Return<CreditsState, Failure> {
    const owner = yield* billingCall(() =>
      this.#database
        .prepare(`SELECT 1 AS owner WHERE ${ownedServerSql("?1", "?2")}`)
        .bind(request.serverId, userId)
        .first<{ owner: number }>(),
    );
    if (!owner)
      return yield* new BillingError(403, "credits_server_owner", sourceText("error.billing.creditsServerOwner"));
    const toServer = request.direction === "to_server";
    const transferId = crypto.randomUUID();
    const debitId = `transfer:${transferId}:out`;
    const now = this.#now();
    const source = toServer ? { user: userId, server: null } : { user: null, server: request.serverId };
    const target = toServer ? { user: null, server: request.serverId } : { user: userId, server: null };
    const sourceColumn = toServer ? "user_id" : "server_id";
    const sourceId = toServer ? userId : request.serverId;
    const tenths = creditTenths(request.credits);
    yield* billingCall(() =>
      this.#database.batch([
        this.#database
          .prepare(
            `INSERT INTO credit_ledger(
               entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at
             )
             SELECT ?1, ?2, ?3, ?4, 'transfer', ?5, ?6, ?7
              WHERE ${availableTenthsSql(sourceColumn, "?8")} - ${overdueGrantTenthsSql(sourceColumn, "?8", "?7")} >= ?9
                AND ${ownedServerSql("?10", "?5")}`,
          )
          .bind(
            debitId,
            source.user,
            source.server,
            -tenths,
            userId,
            transferId,
            now,
            sourceId,
            tenths,
            request.serverId,
          ),
        this.#database
          .prepare(moveGrantsSql(movedGrantsSql("?8"), { user: "?5", server: "?6", transfer: "?7", now: "?8" }))
          .bind(source.user, source.server, tenths, debitId, target.user, target.server, transferId, now),
        this.#database
          .prepare(consumeGrantsSql(movedGrantsSql("?5")))
          .bind(source.user, source.server, tenths, debitId, now),
        this.#database
          .prepare(
            `INSERT INTO credit_ledger(
               entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at
             )
             SELECT ?1, ?2, ?3, ?4, 'transfer', ?5, ?6, ?7
              WHERE EXISTS (SELECT 1 FROM credit_ledger WHERE entry_id = ?8)`,
          )
          .bind(`transfer:${transferId}:in`, target.user, target.server, tenths, userId, transferId, now, debitId),
      ]),
    );
    const moved = yield* billingCall(() =>
      this.#database
        .prepare("SELECT 1 AS moved FROM credit_ledger WHERE entry_id = ?")
        .bind(debitId)
        .first<{ moved: number }>(),
    );
    if (!moved) return yield* new BillingError(409, "credits_not_enough", sourceText("error.billing.creditsNotEnough"));
    this.#analytics.track(userId, {
      name: "credit_action",
      action: "moved",
      wallet: toServer ? "server" : "personal",
      credits: request.credits,
      direction: request.direction,
    });
    return yield* this.getState(userId);
  }).bind(this);

  readonly webhook = Effect.fn("CreditService.webhook")(function* (
    this: CreditService,
    event: StripeEvent,
  ): Effect.fn.Return<void, Failure> {
    if (isCreditCheckoutEvent(event)) {
      const decoded = Schema.decodeUnknownOption(creditSessionSchema)(event.data.object);
      if (Option.isNone(decoded) || decoded.value.mode !== "payment") return;
      const session = decoded.value;
      const paid =
        (event.type === "checkout.session.completed" && session.payment_status === "paid") ||
        event.type === "checkout.session.async_payment_succeeded";
      if (paid) return yield* this.#fulfil(session);
      if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed")
        return yield* this.#expire(session.id);
      return;
    }
    const reversal = paymentReversal(event);
    if (!reversal || (reversal.type !== "payment_refunded" && reversal.type !== "dispute_lost")) return;
    const purchase = yield* billingCall(() =>
      this.#database
        .prepare(
          `SELECT l.user_id, l.server_id, p.user_id AS buyer_id, p.credits, p.currency, p.amount
             FROM credit_purchases p
             JOIN credit_ledger l ON l.entry_id = 'purchase:' || p.checkout_session_id
            WHERE p.payment_intent_id = ? AND p.status = 'paid'`,
        )
        .bind(reversal.paymentIntentId)
        .first<PurchaseRow>(),
    );
    const walletId = purchase?.server_id ?? purchase?.user_id;
    if (!purchase || !walletId) return;
    const purchased = creditTenths(purchase.credits);
    const share =
      purchase.amount && purchase.amount > 0
        ? Math.min(purchased, Math.round((purchased * reversal.amount) / purchase.amount))
        : purchased;
    const column = walletColumn(purchase.server_id);
    const now = this.#now();
    const reversed = yield* billingCall(() =>
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO credit_ledger(
             entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at
           )
           SELECT ?1, ?2, ?3, -MIN(?4, balance), 'reversal', NULL, ?5, ?6
             FROM (SELECT ${availableTenthsSql(column, "?7")} AS balance)
            WHERE balance > 0 AND ?4 > 0
              AND (?2 IS NULL OR EXISTS (SELECT 1 FROM users WHERE id = ?2))
           RETURNING amount_tenths`,
        )
        .bind(
          `reversal:${reversal.objectId}`,
          purchase.user_id,
          purchase.server_id,
          share,
          reversal.objectId,
          now,
          walletId,
        )
        .all<{ amount_tenths: number }>(),
    );
    const entry = reversed.results[0];
    const reversedTenths = entry ? -entry.amount_tenths : 0;
    const duplicate = !entry && (yield* this.#hasEntry(`reversal:${reversal.objectId}`));
    if (!duplicate && reversedTenths < share)
      yield* this.#audit.failed({
        event: "reversal",
        code: "credits_spent",
        wallet: { userId: purchase.user_id, serverId: purchase.server_id },
        actorUserId: purchase.buyer_id,
        credits: creditsFromTenths(share - reversedTenths),
        reference: reversal.objectId,
        detail: { refunded_tenths: share, reversed_tenths: reversedTenths },
      });
    if (!entry) return;
    this.#analytics.track(purchase.buyer_id, {
      name: "credit_action",
      action: "reversed",
      wallet: purchase.server_id === null ? "personal" : "server",
      credits: creditsFromTenths(-entry.amount_tenths),
      ...(isBillingCurrency(purchase.currency) ? { currency: purchase.currency, amount: reversal.amount } : {}),
    });
  }).bind(this);

  readonly #fulfil = Effect.fn("CreditService.fulfil")(function* (
    this: CreditService,
    session: CreditSession,
  ): Effect.fn.Return<void, Failure> {
    const sessionId = session.id;
    const target = creditTarget(session);
    if (!target) {
      console.error("credits: paid checkout has no valid credit target");
      return yield* this.#audit.failed({
        event: "purchase",
        code: "target_invalid",
        reference: sessionId,
        detail: { currency: session.currency ?? null, amount: session.amount_total ?? null },
      });
    }
    const paymentIntent = session.payment_intent ?? null;
    const amount =
      session.amount_total !== undefined && session.amount_total !== null && session.amount_total >= 0
        ? session.amount_total
        : null;
    const currency = session.currency?.toLowerCase() ?? "eur";
    const now = this.#now();
    const [, credited] = yield* billingCall(() =>
      this.#database.batch([
        this.#database
          .prepare(
            `INSERT INTO credit_purchases(
               checkout_session_id, user_id, server_id, credits, currency, amount, payment_intent_id, status,
               created_at, updated_at
             )
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'paid', ?8, ?8
              WHERE EXISTS (SELECT 1 FROM users WHERE id = ?2)
             ON CONFLICT(checkout_session_id) DO UPDATE SET
               status = 'paid', amount = excluded.amount, payment_intent_id = excluded.payment_intent_id,
               updated_at = excluded.updated_at`,
          )
          .bind(sessionId, target.userId, target.serverId, target.credits, currency, amount, paymentIntent, now),
        this.#database
          .prepare(
            `INSERT OR IGNORE INTO credit_ledger(
               entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at
             )
             SELECT ?1, CASE WHEN live THEN NULL ELSE ?2 END, CASE WHEN live THEN ?3 END, ?4, 'purchase', ?2, ?5, ?6
               FROM (SELECT EXISTS (
                      SELECT 1 FROM remote_memberships WHERE host_id = ?3 AND status = 'active'
                    ) AS live)
              WHERE EXISTS (SELECT 1 FROM users WHERE id = ?2)
             RETURNING server_id`,
          )
          .bind(`purchase:${sessionId}`, target.userId, target.serverId, creditTenths(target.credits), sessionId, now),
      ]),
    );
    const entry = credited?.results[0];
    if (!entry) {
      if (yield* this.#hasEntry(`purchase:${sessionId}`)) return;
      console.error("credits: paid checkout was not credited");
      return yield* this.#audit.failed({
        event: "purchase",
        code: "account_missing",
        wallet: { userId: target.serverId === null ? target.userId : null, serverId: target.serverId },
        actorUserId: target.userId,
        credits: target.credits,
        reference: sessionId,
        detail: { currency, amount },
      });
    }
    this.#analytics.track(target.userId, {
      name: "credit_action",
      action: "purchased",
      wallet: isDynamicRecord(entry) && typeof entry.server_id === "string" ? "server" : "personal",
      credits: target.credits,
      ...(isBillingCurrency(currency) ? { currency, amount } : {}),
    });
    const onPurchase = this.#onPurchase;
    if (!onPurchase || !isBillingCurrency(currency)) return;
    const account = yield* billingCall(() =>
      this.#database.prepare("SELECT email FROM users WHERE id = ?").bind(target.userId).first<{ email: string }>(),
    ).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!account) return;
    onPurchase({
      email: account.email,
      credits: target.credits,
      currency,
      amount,
      wallet: isDynamicRecord(entry) && typeof entry.server_id === "string" ? "server" : "personal",
      serverId: target.serverId,
    });
  }).bind(this);

  readonly #expire = Effect.fn("CreditService.expire")(function* (
    this: CreditService,
    sessionId: string,
  ): Effect.fn.Return<void, Failure> {
    const expired = yield* billingCall(() =>
      this.#database
        .prepare(
          `UPDATE credit_purchases SET status = 'expired', updated_at = ?
            WHERE checkout_session_id = ? AND status = 'open'
           RETURNING user_id, server_id, credits, currency`,
        )
        .bind(this.#now(), sessionId)
        .all<ExpiredPurchaseRow>(),
    );
    for (const purchase of expired.results) {
      this.#analytics.track(purchase.user_id, {
        name: "credit_action",
        action: "checkout_expired",
        wallet: purchase.server_id === null ? "personal" : "server",
        credits: purchase.credits,
        ...(isBillingCurrency(purchase.currency) ? { currency: purchase.currency } : {}),
      });
    }
  }).bind(this);

  readonly #hasEntry = Effect.fn("CreditService.hasEntry")(function* (
    this: CreditService,
    entryId: string,
  ): Effect.fn.Return<boolean, Failure> {
    const row = yield* billingCall(() =>
      this.#database
        .prepare("SELECT 1 AS present FROM credit_ledger WHERE entry_id = ?")
        .bind(entryId)
        .first<{ present: number }>(),
    );
    return row !== null;
  });

  readonly #isMember = Effect.fn("CreditService.isMember")(function* (
    this: CreditService,
    userId: string,
    serverId: string,
  ): Effect.fn.Return<boolean, Failure> {
    const row = yield* billingCall(() =>
      this.#database
        .prepare(
          `SELECT 1 AS member FROM remote_memberships
            WHERE host_id = ?1 AND user_id = ?2 AND status = 'active'`,
        )
        .bind(serverId, userId)
        .first<{ member: number }>(),
    );
    return row !== null;
  });

  readonly #lockedCurrency = Effect.fn("CreditService.lockedCurrency")(function* (
    this: CreditService,
    userId: string,
  ): Effect.fn.Return<BillingCurrency | null, Failure> {
    const row = yield* billingCall(() =>
      this.#database
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

  readonly #prices = Effect.fn("CreditService.prices")(function* (
    this: CreditService,
  ): Effect.fn.Return<ReadonlyMap<string, StripePrice>, Failure> {
    const now = this.#now();
    const cached = priceCache.get(this.#secretKey);
    if (cached && cached.expiresAt > now) return cached.prices;
    const list = yield* this.#stripeCall(() => this.#stripe.listPricesByLookupKeys(CREDIT_LOOKUP_KEYS));
    const prices = new Map(list.flatMap((price) => (price.lookup_key ? [[price.lookup_key, price] as const] : [])));
    priceCache.set(this.#secretKey, { expiresAt: now + PRICE_TTL_MS, prices });
    return prices;
  });

  readonly #stripeCall = Effect.fn("CreditService.stripeCall")(
    <T>(call: () => Effect.Effect<T, StripeRequestError | StripeTransportError>) =>
      stripeRequest(call).pipe(Effect.mapError(stripeFailure)),
  );
}

function unavailable(): Effect.Effect<never, BillingError> {
  return Effect.fail(new BillingError(503, "credits_unavailable", sourceText("error.billing.creditsUnavailable")));
}
