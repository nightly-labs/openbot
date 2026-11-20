import { BILLING_CURRENCIES, type BillingCurrency, isBillingAmount } from "@openbot/contracts/billing";
import {
  convertReferralAmount,
  REFERRAL_SHARE_PERCENT,
  type ReferralMoney,
  referralMinimum,
  referralShare,
} from "@openbot/contracts/referral";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { Effect, Option, Schema } from "effect";
import { type BillingError, BillingOperationError, billingCall, stripeFailure, stripeRequest } from "./billing-errors";
import { type PaymentReversal, paymentReversal, withoutTax } from "./billing-sales";
import type { Referrals } from "./referrals";
import type { StripeClient, StripeEvent, StripeRequestError, StripeTransportError } from "./stripe-client";

const REFERRAL_COUPON_ID = `openbot-invite-${REFERRAL_SHARE_PERCENT}`;
const FIRST_PAYMENT_COUPON_ID = `openbot-invite-${REFERRAL_SHARE_PERCENT}-first`;
const PART_DAYS = 30;
const PART_MS = PART_DAYS * 86_400_000;
const MAX_PARTS = 12;
const DUE_REFERRERS_PER_RUN = 50;

const paidInvoiceSchema = Schema.Struct({
  id: Schema.String,
  customer: Schema.String,
  currency: Schema.String,
  amount_paid: Schema.Number,
  total: Schema.optional(Schema.NullOr(Schema.Number)),
  total_excluding_tax: Schema.optional(Schema.NullOr(Schema.Number)),
  billing_reason: Schema.optional(Schema.NullOr(Schema.String)),
  status_transitions: Schema.optional(
    Schema.NullOr(Schema.Struct({ paid_at: Schema.optional(Schema.NullOr(Schema.Number)) })),
  ),
  discounts: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
  lines: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        data: Schema.Array(
          Schema.Struct({
            period: Schema.optional(Schema.NullOr(Schema.Struct({ start: Schema.Number, end: Schema.Number }))),
          }),
        ),
      }),
    ),
  ),
  parent: Schema.Struct({
    subscription_details: Schema.Struct({
      subscription: Schema.Union([Schema.String, Schema.Struct({ id: Schema.String })]),
    }),
  }),
});

type PaidInvoice = typeof paidInvoiceSchema.Type;

interface CreditRow {
  invoice_id: string;
  referrer_user_id: string;
  referred_user_id: string;
  source_currency: string;
  source_amount: number;
  source_invoice_id: string | null;
  ready_at: number | null;
  currency: string;
  amount: number;
  reversed_amount: number;
  balance_transaction_id: string | null;
  queued_at: number | null;
}

const CREDIT_COLUMNS =
  "invoice_id, referrer_user_id, referred_user_id, source_currency, source_amount, source_invoice_id, ready_at, currency, amount, reversed_amount, balance_transaction_id, queued_at";

type Failure = BillingError | BillingOperationError;

export class BillingReferral {
  readonly #database: D1Database;
  readonly #stripe: StripeClient;
  readonly #referrals: Referrals;
  readonly #now: () => number;
  readonly #ensureCustomer: (user: { id: string; email: string }) => Effect.Effect<string, Failure>;

  constructor(options: {
    database: D1Database;
    stripe: StripeClient;
    referrals: Referrals;
    now: () => number;
    ensureCustomer: (user: { id: string; email: string }) => Effect.Effect<string, Failure>;
  }) {
    this.#database = options.database;
    this.#stripe = options.stripe;
    this.#referrals = options.referrals;
    this.#now = options.now;
    this.#ensureCustomer = options.ensureCustomer;
  }

  readonly couponFor = Effect.fn("BillingReferral.couponFor")(function* (
    this: BillingReferral,
    userId: string,
  ): Effect.fn.Return<string | null, Failure> {
    if (!(yield* this.#referrals.isReferred(userId))) return null;
    if (yield* this.#hasPurchase(userId)) return null;
    return yield* this.#stripe
      .ensureReferralCoupon({
        id: FIRST_PAYMENT_COUPON_ID,
        percentOff: REFERRAL_SHARE_PERCENT,
        name: `Invite: ${REFERRAL_SHARE_PERCENT}% off the first payment`,
      })
      .pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            console.warn("billing: the invite coupon is not available");
            return null;
          }),
        ),
      );
  }).bind(this);

  readonly keptCoupon = Effect.fn("BillingReferral.keptCoupon")(function* (
    this: BillingReferral,
    subscriptionId: string,
  ): Effect.fn.Return<string | null, Failure> {
    const couponIds = yield* this.#stripeCall(() => this.#stripe.subscriptionCouponIds(subscriptionId));
    return couponIds.includes(REFERRAL_COUPON_ID) ? REFERRAL_COUPON_ID : null;
  }).bind(this);

  readonly credit = Effect.fn("BillingReferral.credit")(function* (
    this: BillingReferral,
    userId: string,
  ): Effect.fn.Return<ReferralMoney[], Failure> {
    const customerId = yield* this.#customerId(userId);
    if (!customerId) return [];
    const customer = yield* this.#stripeCall(() => this.#stripe.getCustomerCredit(customerId));
    const credit: ReferralMoney[] = [];
    for (const [currency, amountMinor] of Object.entries(customer?.credit ?? {})) {
      if (isOneOf(BILLING_CURRENCIES, currency)) credit.push({ currency, amountMinor });
    }
    return credit;
  }).bind(this);

  readonly record = Effect.fn("BillingReferral.record")(function* (
    this: BillingReferral,
    event: StripeEvent,
    payment: { invoiceId: string; total: number | null; totalExcludingTax: number | null } | null,
    ownerId: string | null,
  ): Effect.fn.Return<void, Failure> {
    if (event.type === "invoice.paid") {
      const decoded = Schema.decodeUnknownOption(paidInvoiceSchema)(event.data.object);
      if (Option.isNone(decoded)) return;
      yield* this.#endFirstPaymentDiscount(decoded.value);
      return yield* this.#creditInvoice(decoded.value);
    }
    const reversal = paymentReversal(event);
    if (reversal && payment && (reversal.type === "payment_refunded" || reversal.type === "dispute_lost")) {
      yield* this.#reverse(reversal, payment, ownerId);
    }
  }).bind(this);

  readonly releaseDue = Effect.fn("BillingReferral.releaseDue")(function* (
    this: BillingReferral,
  ): Effect.fn.Return<number, Failure> {
    const due = yield* billingCall(() =>
      this.#database
        .prepare(
          `SELECT referrer FROM (
             SELECT referrer_user_id AS referrer FROM referral_credits
             WHERE released_at IS NULL AND ready_at IS NOT NULL AND ready_at <= ?1 AND balance_transaction_id IS NULL
             UNION
             SELECT referrer_user_id FROM referral_credits
             WHERE queued_at IS NOT NULL AND balance_transaction_id IS NULL
           ) ORDER BY RANDOM() LIMIT ?2`,
        )
        .bind(this.#now(), DUE_REFERRERS_PER_RUN)
        .all<{ referrer: string }>(),
    );
    const referrers = due.results ?? [];
    let failed = 0;
    for (const { referrer } of referrers) {
      const exit = yield* Effect.exit(this.#sendReady(referrer));
      if (exit._tag === "Failure") failed += 1;
    }
    if (failed > 0) console.warn("billing: invite credit parts were released but not sent", { failed });
    return referrers.length;
  }).bind(this);

  readonly #hasPurchase = Effect.fn("BillingReferral.hasPurchase")(function* (
    this: BillingReferral,
    userId: string,
  ): Effect.fn.Return<boolean, Failure> {
    const row = yield* billingCall(() =>
      this.#database
        .prepare(
          `SELECT 1 AS bought FROM billing_subscriptions
             WHERE user_id = ?1 AND status NOT IN ('incomplete', 'incomplete_expired')
           UNION ALL
           SELECT 1 FROM licenses WHERE user_id = ?1 AND status NOT IN ('incomplete', 'incomplete_expired')
           UNION ALL
           SELECT 1 FROM referral_credits WHERE referred_user_id = ?1
           LIMIT 1`,
        )
        .bind(userId)
        .first<{ bought: number }>(),
    );
    return row !== null;
  }).bind(this);

  readonly #endFirstPaymentDiscount = Effect.fn("BillingReferral.endFirstPaymentDiscount")(function* (
    this: BillingReferral,
    invoice: PaidInvoice,
  ): Effect.fn.Return<void, Failure> {
    if ((invoice.total ?? invoice.amount_paid) <= 0 || (invoice.discounts ?? []).length === 0) return;
    const referred = yield* billingCall(() =>
      this.#database
        .prepare(
          `SELECT 1 AS referred FROM billing_customers c
           JOIN referrals r ON r.referred_user_id = c.user_id
           WHERE c.stripe_customer_id = ?`,
        )
        .bind(invoice.customer)
        .first<{ referred: number }>(),
    );
    if (!referred) return;
    yield* this.#stripeCall(() =>
      this.#stripe.removeSubscriptionCoupon(invoiceSubscriptionId(invoice), [FIRST_PAYMENT_COUPON_ID]),
    );
  }).bind(this);

  readonly #creditInvoice = Effect.fn("BillingReferral.creditInvoice")(function* (
    this: BillingReferral,
    invoice: PaidInvoice,
  ): Effect.fn.Return<void, Failure> {
    const sourceCurrency = invoice.currency.toLowerCase();
    if (!isOneOf(BILLING_CURRENCIES, sourceCurrency) || !isBillingAmount(invoice.amount_paid)) return;
    const share = referralShare(withoutTax(invoice.amount_paid, invoice.total, invoice.total_excluding_tax));
    if (share === 0) return;
    let row = yield* this.#creditRow(invoice.id);
    if (!row) {
      const pair = yield* billingCall(() =>
        this.#database
          .prepare(
            `SELECT c.user_id AS friend, r.referrer_user_id AS referrer, u.email AS email, r.blocked_at AS blocked_at
             FROM billing_customers c
             JOIN referrals r ON r.referred_user_id = c.user_id
             JOIN users u ON u.id = r.referrer_user_id
             WHERE c.stripe_customer_id = ?`,
          )
          .bind(invoice.customer)
          .first<{ friend: string; referrer: string; email: string; blocked_at: number | null }>(),
      );
      if (!pair) return;
      if (pair.blocked_at !== null || (yield* this.#sameCard(pair.referrer, invoice.customer))) {
        return yield* this.#block(pair.friend, invoiceSubscriptionId(invoice));
      }
      const customerId = yield* this.#ensureCustomer({ id: pair.referrer, email: pair.email });
      const customer = yield* this.#stripeCall(() => this.#stripe.getCustomerCredit(customerId));
      const currency: BillingCurrency =
        customer?.currency && isOneOf(BILLING_CURRENCIES, customer.currency) ? customer.currency : sourceCurrency;
      const parts = splitAmount(share, invoiceParts(invoice));
      const split = parts.length > 1;
      const now = this.#now();
      const paidAt = invoice.status_transitions?.paid_at;
      const start = typeof paidAt === "number" && paidAt > 0 ? paidAt * 1_000 : now;
      yield* billingCall(() =>
        this.#database.batch(
          parts.map((source, index) =>
            this.#database
              .prepare(
                `INSERT OR IGNORE INTO referral_credits(
                   invoice_id, referrer_user_id, referred_user_id, source_currency, source_amount, currency, amount,
                   source_invoice_id, ready_at, created_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .bind(
                index === 0 ? invoice.id : `${invoice.id}:${index + 1}`,
                pair.referrer,
                pair.friend,
                sourceCurrency,
                source,
                currency,
                convertReferralAmount(source, sourceCurrency, currency),
                split ? invoice.id : null,
                split ? start + (index + 1) * PART_MS : null,
                now,
              ),
          ),
        ),
      );
      row = yield* this.#creditRow(invoice.id);
    }
    if (!row) return;
    const friend = row.referred_user_id;
    const progress = yield* billingCall(() =>
      this.#database
        .prepare(
          `SELECT COUNT(DISTINCT COALESCE(source_invoice_id, invoice_id)) AS payments, COUNT(released_at) AS released
           FROM referral_credits WHERE referred_user_id = ?`,
        )
        .bind(friend)
        .first<{ payments: number; released: number }>(),
    );
    const released =
      (progress?.released ?? 0) > 0 ||
      (invoice.billing_reason === "subscription_cycle" && (progress?.payments ?? 0) >= 2);
    if (released) {
      yield* billingCall(() =>
        this.#database
          .prepare(
            `UPDATE referral_credits SET released_at = ?2
             WHERE referred_user_id = ?1 AND released_at IS NULL AND ready_at IS NULL`,
          )
          .bind(friend, this.#now())
          .run(),
      );
    }
    yield* this.#sendReady(row.referrer_user_id);
  }).bind(this);

  readonly #sameCard = Effect.fn("BillingReferral.sameCard")(function* (
    this: BillingReferral,
    referrer: string,
    friendCustomerId: string,
  ): Effect.fn.Return<boolean, Failure> {
    const referrerCustomerId = yield* this.#customerId(referrer);
    if (!referrerCustomerId) return false;
    const [friendCards, referrerCards] = yield* Effect.all(
      [
        this.#stripeCall(() => this.#stripe.cardFingerprints(friendCustomerId)),
        this.#stripeCall(() => this.#stripe.cardFingerprints(referrerCustomerId)),
      ],
      { concurrency: 2 },
    );
    for (const card of friendCards) if (referrerCards.has(card)) return true;
    return false;
  }).bind(this);

  readonly #block = Effect.fn("BillingReferral.block")(function* (
    this: BillingReferral,
    friend: string,
    subscriptionId: string,
  ): Effect.fn.Return<void, Failure> {
    yield* this.#stripeCall(() =>
      this.#stripe.removeSubscriptionCoupon(subscriptionId, [REFERRAL_COUPON_ID, FIRST_PAYMENT_COUPON_ID]),
    );
    const now = this.#now();
    const [blocked] = yield* billingCall(() =>
      this.#database.batch([
        this.#database
          .prepare("UPDATE referrals SET blocked_at = ?2 WHERE referred_user_id = ?1 AND blocked_at IS NULL")
          .bind(friend, now),
        this.#database
          .prepare(
            `UPDATE referral_credits SET reversed_amount = amount, balance_transaction_id = ''
             WHERE referred_user_id = ? AND balance_transaction_id IS NULL AND queued_at IS NULL`,
          )
          .bind(friend),
      ]),
    );
    if ((blocked?.meta.changes ?? 0) > 0)
      console.warn("billing: an invite ended: the friend paid with the referrer's card");
  }).bind(this);

  readonly #sendReady = Effect.fn("BillingReferral.sendReady")(function* (
    this: BillingReferral,
    referrer: string,
  ): Effect.fn.Return<void, Failure> {
    yield* this.#followReferrerCurrency(referrer);
    const now = this.#now();
    const totals = yield* billingCall(() =>
      this.#database
        .prepare(
          `SELECT currency, SUM(amount - reversed_amount) AS amount FROM referral_credits
           WHERE referrer_user_id = ?1 AND queued_at IS NULL AND balance_transaction_id IS NULL
             AND (released_at IS NOT NULL OR (ready_at IS NOT NULL AND ready_at <= ?2))
           GROUP BY currency`,
        )
        .bind(referrer, now)
        .all<{ currency: string; amount: number }>(),
    );
    const full: BillingCurrency[] = [];
    for (const total of totals.results ?? []) {
      if (isOneOf(BILLING_CURRENCIES, total.currency) && total.amount >= referralMinimum(total.currency)) {
        full.push(total.currency);
      }
    }
    yield* billingCall(() =>
      this.#database.batch([
        this.#database
          .prepare(
            `UPDATE referral_credits SET released_at = ?2
             WHERE referrer_user_id = ?1 AND released_at IS NULL AND ready_at IS NOT NULL AND ready_at <= ?2`,
          )
          .bind(referrer, now),
        this.#database
          .prepare(
            `UPDATE referral_credits SET queued_at = ?2
             WHERE referrer_user_id = ?1 AND released_at IS NOT NULL AND queued_at IS NULL
               AND balance_transaction_id IS NULL AND currency IN (SELECT value FROM json_each(?3))`,
          )
          .bind(referrer, now, JSON.stringify(full)),
      ]),
    );
    const queued = yield* billingCall(() =>
      this.#database
        .prepare(`SELECT ${CREDIT_COLUMNS} FROM referral_credits
                  WHERE referrer_user_id = ? AND queued_at IS NOT NULL AND balance_transaction_id IS NULL
                  ORDER BY created_at, invoice_id`)
        .bind(referrer)
        .all<CreditRow>(),
    );
    for (const credit of queued.results ?? []) yield* this.#send(credit);
  }).bind(this);

  readonly #followReferrerCurrency = Effect.fn("BillingReferral.followReferrerCurrency")(function* (
    this: BillingReferral,
    referrer: string,
  ): Effect.fn.Return<void, Failure> {
    const waiting = yield* billingCall(() =>
      this.#database
        .prepare(
          `SELECT invoice_id, source_currency, source_amount, currency FROM referral_credits
           WHERE referrer_user_id = ? AND queued_at IS NULL AND balance_transaction_id IS NULL`,
        )
        .bind(referrer)
        .all<{ invoice_id: string; source_currency: string; source_amount: number; currency: string }>(),
    );
    const rows = waiting.results ?? [];
    if (rows.length === 0) return;
    const customerId = yield* this.#customerId(referrer);
    if (!customerId) return;
    const customer = yield* this.#stripeCall(() => this.#stripe.getCustomerCredit(customerId));
    const target = customer?.currency;
    if (!target || !isOneOf(BILLING_CURRENCIES, target)) return;
    const statements: D1PreparedStatement[] = [];
    for (const row of rows) {
      if (row.currency === target) continue;
      if (!isOneOf(BILLING_CURRENCIES, row.currency) || !isOneOf(BILLING_CURRENCIES, row.source_currency)) continue;
      const amount = convertReferralAmount(row.source_amount, row.source_currency, target);
      const from = row.currency;
      const reversals = yield* billingCall(() =>
        this.#database
          .prepare("SELECT reversal_id, amount FROM referral_reversals WHERE invoice_id = ?")
          .bind(row.invoice_id)
          .all<{ reversal_id: string; amount: number }>(),
      );
      for (const reversal of reversals.results ?? []) {
        statements.push(
          this.#database
            .prepare(
              `UPDATE referral_reversals SET amount = ?1 WHERE reversal_id = ?2
               AND EXISTS (SELECT 1 FROM referral_credits WHERE invoice_id = ?3 AND currency = ?4)`,
            )
            .bind(
              Math.min(amount, convertReferralAmount(reversal.amount, from, target)),
              reversal.reversal_id,
              row.invoice_id,
              from,
            ),
        );
      }
      statements.push(
        this.#database
          .prepare(
            `UPDATE referral_credits SET currency = ?, amount = ?, reversed_amount = 0
             WHERE invoice_id = ? AND currency = ? AND queued_at IS NULL AND balance_transaction_id IS NULL`,
          )
          .bind(target, amount, row.invoice_id, from),
        this.#reversedAmount(row.invoice_id),
      );
    }
    if (statements.length > 0) yield* billingCall(() => this.#database.batch(statements));
  }).bind(this);

  readonly #send = Effect.fn("BillingReferral.send")(function* (
    this: BillingReferral,
    credit: CreditRow,
  ): Effect.fn.Return<void, Failure> {
    const amount = credit.amount - credit.reversed_amount;
    let transactionId = "";
    if (amount > 0) {
      const referrerCustomer = yield* this.#customerId(credit.referrer_user_id);
      if (!referrerCustomer) return yield* new BillingOperationError({});
      transactionId = yield* this.#stripeCall(() =>
        this.#stripe.addCustomerBalance(
          {
            customerId: referrerCustomer,
            amount: -amount,
            currency: credit.currency,
            description: `Invite credit: ${REFERRAL_SHARE_PERCENT}% of a payment of a friend`,
          },
          `openbot-invite-credit-${credit.invoice_id}`,
        ),
      );
    }
    yield* billingCall(() =>
      this.#database
        .prepare("UPDATE referral_credits SET balance_transaction_id = ? WHERE invoice_id = ?")
        .bind(transactionId, credit.invoice_id)
        .run(),
    );
  }).bind(this);

  readonly #reverse = Effect.fn("BillingReferral.reverse")(function* (
    this: BillingReferral,
    reversal: PaymentReversal,
    payment: { invoiceId: string; total: number | null; totalExcludingTax: number | null },
    ownerId: string | null,
  ): Effect.fn.Return<void, Failure> {
    const share = referralShare(withoutTax(reversal.amount, payment.total, payment.totalExcludingTax));
    const rows = yield* this.#invoiceCredits(payment.invoiceId);
    if (rows.length === 0) {
      if (share > 0 && ownerId && (yield* this.#referrals.isReferred(ownerId))) {
        return yield* new BillingOperationError({});
      }
      return;
    }
    if (rows.some((row) => row.source_invoice_id !== null)) {
      return yield* this.#reverseParts(reversal, payment.invoiceId, share, rows);
    }
    yield* this.#reverseOne(reversal, payment, share);
  }).bind(this);

  readonly #reverseOne = Effect.fn("BillingReferral.reverseOne")(function* (
    this: BillingReferral,
    reversal: PaymentReversal,
    payment: { invoiceId: string },
    share: number,
  ): Effect.fn.Return<void, Failure> {
    let credit = yield* this.#creditRow(payment.invoiceId);
    if (credit && credit.queued_at !== null && credit.balance_transaction_id === null) {
      yield* this.#send(credit);
      credit = yield* this.#creditRow(payment.invoiceId);
    }
    if (!credit || !isOneOf(BILLING_CURRENCIES, credit.source_currency)) return;
    if (!isOneOf(BILLING_CURRENCIES, credit.currency)) return;
    if (credit.balance_transaction_id === null) {
      const amount = Math.max(
        0,
        Math.min(
          convertReferralAmount(share, credit.source_currency, credit.currency),
          credit.amount - credit.reversed_amount,
        ),
      );
      yield* billingCall(() =>
        this.#database.batch([
          this.#database
            .prepare(
              `INSERT OR IGNORE INTO referral_reversals(reversal_id, invoice_id, amount, balance_transaction_id, created_at)
               SELECT ?1, ?2, ?3, '', ?4 WHERE EXISTS (
                 SELECT 1 FROM referral_credits
                 WHERE invoice_id = ?2 AND currency = ?5 AND queued_at IS NULL AND balance_transaction_id IS NULL
               )`,
            )
            .bind(reversal.objectId, payment.invoiceId, amount, this.#now(), credit.currency),
          this.#reversedAmount(payment.invoiceId),
        ]),
      );
      if (!(yield* this.#reversalRow(reversal.objectId))) return yield* new BillingOperationError({});
      return;
    }
    if (credit.balance_transaction_id === "") return;
    const customerId = yield* this.#customerId(credit.referrer_user_id);
    if (!customerId) return;
    let row = yield* this.#reversalRow(reversal.objectId);
    if (!row) {
      const customer = yield* this.#stripeCall(() => this.#stripe.getCustomerCredit(customerId));
      const available = customer?.credit[credit.currency] ?? 0;
      const amount = Math.max(
        0,
        Math.min(
          convertReferralAmount(share, credit.source_currency, credit.currency),
          credit.amount - credit.reversed_amount,
          available,
        ),
      );
      yield* billingCall(() =>
        this.#database
          .prepare(
            `INSERT OR IGNORE INTO referral_reversals(reversal_id, invoice_id, amount, balance_transaction_id, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(reversal.objectId, payment.invoiceId, amount, amount === 0 ? "" : null, this.#now())
          .run(),
      );
      row = yield* this.#reversalRow(reversal.objectId);
    }
    if (!row || row.balance_transaction_id !== null) return;
    const amount = row.amount;
    const transactionId = yield* this.#stripeCall(() =>
      this.#stripe.addCustomerBalance(
        {
          customerId,
          amount,
          currency: credit.currency,
          description: "Invite credit taken back: the payment of the friend was refunded",
        },
        `openbot-invite-reversal-${reversal.objectId}`,
      ),
    );
    yield* billingCall(() =>
      this.#database.batch([
        this.#database
          .prepare("UPDATE referral_reversals SET balance_transaction_id = ? WHERE reversal_id = ?")
          .bind(transactionId, reversal.objectId),
        this.#reversedAmount(payment.invoiceId),
      ]),
    );
  }).bind(this);

  readonly #reverseParts = Effect.fn("BillingReferral.reverseParts")(function* (
    this: BillingReferral,
    reversal: PaymentReversal,
    invoiceId: string,
    share: number,
    rows: readonly CreditRow[],
  ): Effect.fn.Return<void, Failure> {
    for (const row of rows) if (row.queued_at !== null && row.balance_transaction_id === null) yield* this.#send(row);
    const parts = yield* this.#invoiceCredits(invoiceId);
    const prefix = `${reversal.objectId}|`;
    const decided = yield* this.#partReversals(invoiceId, prefix);
    let remaining = share - decided.reduce((sum, row) => sum + (row.source_amount ?? 0), 0);
    const done = new Set(decided.map((row) => row.invoice_id));
    const order = parts
      .filter((part) => !done.has(part.invoice_id) && part.balance_transaction_id !== "")
      .sort(
        (a, b) =>
          Number(a.balance_transaction_id !== null) - Number(b.balance_transaction_id !== null) ||
          (b.ready_at ?? 0) - (a.ready_at ?? 0),
      );
    const referrer = parts[0]?.referrer_user_id;
    let available: Map<string, number> | null = null;
    const statements: D1PreparedStatement[] = [];
    const expected: string[] = [];
    for (const part of order) {
      if (remaining <= 0) break;
      const left = part.amount - part.reversed_amount;
      const leftSource = part.amount > 0 ? Math.floor((part.source_amount * left) / part.amount) : 0;
      if (left <= 0 || leftSource <= 0) continue;
      const takeSource = Math.min(remaining, leftSource);
      let take =
        takeSource === leftSource ? left : Math.min(left, Math.floor((takeSource * part.amount) / part.source_amount));
      const sent = part.balance_transaction_id !== null;
      if (sent) {
        if (!available) available = yield* this.#availableCredit(referrer);
        take = Math.min(take, available.get(part.currency) ?? 0);
        available.set(part.currency, (available.get(part.currency) ?? 0) - take);
      }
      remaining -= takeSource;
      const reversalId = `${prefix}${part.invoice_id}`;
      expected.push(reversalId);
      statements.push(
        sent
          ? this.#database
              .prepare(
                `INSERT OR IGNORE INTO referral_reversals(
                   reversal_id, invoice_id, amount, source_amount, balance_transaction_id, created_at
                 ) VALUES (?, ?, ?, ?, ?, ?)`,
              )
              .bind(reversalId, part.invoice_id, take, takeSource, take === 0 ? "" : null, this.#now())
          : this.#database
              .prepare(
                `INSERT OR IGNORE INTO referral_reversals(
                   reversal_id, invoice_id, amount, source_amount, balance_transaction_id, created_at
                 )
                 SELECT ?1, ?2, ?3, ?4, '', ?5 WHERE EXISTS (
                   SELECT 1 FROM referral_credits
                   WHERE invoice_id = ?2 AND currency = ?6 AND queued_at IS NULL AND balance_transaction_id IS NULL
                 )`,
              )
              .bind(reversalId, part.invoice_id, take, takeSource, this.#now(), part.currency),
        this.#reversedAmount(part.invoice_id),
      );
    }
    if (statements.length > 0) yield* billingCall(() => this.#database.batch(statements));
    const recorded = yield* this.#partReversals(invoiceId, prefix);
    const ids = new Set(recorded.map((row) => row.reversal_id));
    if (expected.some((id) => !ids.has(id))) return yield* new BillingOperationError({});
    const customerId = referrer ? yield* this.#customerId(referrer) : null;
    for (const row of recorded) {
      if (row.balance_transaction_id !== null || !customerId) continue;
      const part = parts.find((candidate) => candidate.invoice_id === row.invoice_id);
      if (!part) continue;
      const transactionId = yield* this.#stripeCall(() =>
        this.#stripe.addCustomerBalance(
          {
            customerId,
            amount: row.amount,
            currency: part.currency,
            description: "Invite credit taken back: the payment of the friend was refunded",
          },
          `openbot-invite-reversal-${row.reversal_id}`,
        ),
      );
      yield* billingCall(() =>
        this.#database.batch([
          this.#database
            .prepare("UPDATE referral_reversals SET balance_transaction_id = ? WHERE reversal_id = ?")
            .bind(transactionId, row.reversal_id),
          this.#reversedAmount(row.invoice_id),
        ]),
      );
    }
  }).bind(this);

  readonly #partReversals = Effect.fn("BillingReferral.partReversals")(function* (
    this: BillingReferral,
    invoiceId: string,
    prefix: string,
  ): Effect.fn.Return<
    {
      reversal_id: string;
      invoice_id: string;
      amount: number;
      source_amount: number | null;
      balance_transaction_id: string | null;
    }[],
    Failure
  > {
    const rows = yield* billingCall(() =>
      this.#database
        .prepare(
          `SELECT reversal_id, invoice_id, amount, source_amount, balance_transaction_id FROM referral_reversals
           WHERE substr(reversal_id, 1, ?3) = ?2 AND invoice_id IN (
             SELECT invoice_id FROM referral_credits WHERE invoice_id = ?1 OR source_invoice_id = ?1
           )
           ORDER BY reversal_id`,
        )
        .bind(invoiceId, prefix, prefix.length)
        .all<{
          reversal_id: string;
          invoice_id: string;
          amount: number;
          source_amount: number | null;
          balance_transaction_id: string | null;
        }>(),
    );
    return rows.results ?? [];
  }).bind(this);

  readonly #availableCredit = Effect.fn("BillingReferral.availableCredit")(function* (
    this: BillingReferral,
    referrer: string | undefined,
  ): Effect.fn.Return<Map<string, number>, Failure> {
    if (!referrer) return new Map();
    const credit = yield* this.credit(referrer);
    return new Map(credit.map((money) => [money.currency, money.amountMinor]));
  }).bind(this);

  readonly #invoiceCredits = Effect.fn("BillingReferral.invoiceCredits")(function* (
    this: BillingReferral,
    invoiceId: string,
  ): Effect.fn.Return<CreditRow[], Failure> {
    const rows = yield* billingCall(() =>
      this.#database
        .prepare(
          `SELECT ${CREDIT_COLUMNS} FROM referral_credits WHERE invoice_id = ?1 OR source_invoice_id = ?1
           ORDER BY ready_at, invoice_id`,
        )
        .bind(invoiceId)
        .all<CreditRow>(),
    );
    return rows.results ?? [];
  }).bind(this);

  #reversedAmount(invoiceId: string): D1PreparedStatement {
    return this.#database
      .prepare(
        `UPDATE referral_credits SET reversed_amount = MIN(amount, (
           SELECT COALESCE(SUM(amount), 0) FROM referral_reversals
           WHERE invoice_id = ?1 AND balance_transaction_id IS NOT NULL
         )) WHERE invoice_id = ?1`,
      )
      .bind(invoiceId);
  }

  readonly #creditRow = Effect.fn("BillingReferral.creditRow")(function* (
    this: BillingReferral,
    invoiceId: string,
  ): Effect.fn.Return<CreditRow | null, Failure> {
    return yield* billingCall(() =>
      this.#database
        .prepare(`SELECT ${CREDIT_COLUMNS} FROM referral_credits WHERE invoice_id = ?`)
        .bind(invoiceId)
        .first<CreditRow>(),
    );
  }).bind(this);

  readonly #reversalRow = Effect.fn("BillingReferral.reversalRow")(function* (
    this: BillingReferral,
    reversalId: string,
  ): Effect.fn.Return<{ amount: number; balance_transaction_id: string | null } | null, Failure> {
    return yield* billingCall(() =>
      this.#database
        .prepare("SELECT amount, balance_transaction_id FROM referral_reversals WHERE reversal_id = ?")
        .bind(reversalId)
        .first<{ amount: number; balance_transaction_id: string | null }>(),
    );
  }).bind(this);

  readonly #customerId = Effect.fn("BillingReferral.customerId")(function* (
    this: BillingReferral,
    userId: string,
  ): Effect.fn.Return<string | null, Failure> {
    const row = yield* billingCall(() =>
      this.#database
        .prepare("SELECT stripe_customer_id FROM billing_customers WHERE user_id = ?")
        .bind(userId)
        .first<{ stripe_customer_id: string }>(),
    );
    return row?.stripe_customer_id ?? null;
  }).bind(this);

  readonly #stripeCall = <T>(call: () => Effect.Effect<T, StripeRequestError | StripeTransportError>) =>
    stripeRequest(call).pipe(Effect.mapError(stripeFailure));
}

function invoiceSubscriptionId(invoice: PaidInvoice): string {
  const subscription = invoice.parent.subscription_details.subscription;
  return typeof subscription === "string" ? subscription : subscription.id;
}

function invoiceParts(invoice: PaidInvoice): number {
  let longest = 0;
  for (const line of invoice.lines?.data ?? []) {
    if (line.period) longest = Math.max(longest, line.period.end - line.period.start);
  }
  return Math.min(MAX_PARTS, Math.max(1, Math.round((longest * 1_000) / PART_MS)));
}

function splitAmount(amount: number, parts: number): number[] {
  const base = Math.floor(amount / parts);
  const rest = amount - base * parts;
  return Array.from({ length: parts }, (_, index) => base + (index < rest ? 1 : 0));
}
