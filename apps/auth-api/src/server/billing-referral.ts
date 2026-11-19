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

/** The Stripe coupon of the invite discount. The ID is fixed, so each Worker finds the same coupon. */
const REFERRAL_COUPON_ID = `openbot-invite-${REFERRAL_SHARE_PERCENT}`;

/**
 * A paid invoice of a plan or a license. An invoice with no subscription gets no credit: a refund finds its
 * invoice through the subscription (`getPaymentInvoice`), so it could not take that credit back.
 */
const paidInvoiceSchema = Schema.Struct({
  id: Schema.String,
  customer: Schema.String,
  currency: Schema.String,
  amount_paid: Schema.Number,
  total: Schema.optional(Schema.NullOr(Schema.Number)),
  total_excluding_tax: Schema.optional(Schema.NullOr(Schema.Number)),
  billing_reason: Schema.optional(Schema.NullOr(Schema.String)),
  parent: Schema.Struct({
    subscription_details: Schema.Struct({
      subscription: Schema.Union([Schema.String, Schema.Struct({ id: Schema.String })]),
    }),
  }),
});

interface CreditRow {
  invoice_id: string;
  referrer_user_id: string;
  referred_user_id: string;
  source_currency: string;
  currency: string;
  amount: number;
  reversed_amount: number;
  balance_transaction_id: string | null;
  queued_at: number | null;
}

const CREDIT_COLUMNS =
  "invoice_id, referrer_user_id, referred_user_id, source_currency, currency, amount, reversed_amount, balance_transaction_id, queued_at";

type Failure = BillingError | BillingOperationError;

/**
 * The money part of Invite friends. A friend gets the invite coupon at each Checkout. Each paid invoice of
 * a friend gives the referrer `REFERRAL_SHARE_PERCENT` of its amount without tax as Stripe customer
 * credit, which Stripe takes off the referrer's next invoice. A refund or a lost dispute takes the same
 * share back, but never more than the credit that the referrer still has.
 *
 * The credit waits until the friend pays a second time: the first renewal of a plan, about one month later
 * on a monthly plan. A friend who stops or gets a refund before then gives no credit. At that renewal, the
 * credit of each payment until then is released; after it, each payment is released at once. Released
 * credit collects in D1 and goes to Stripe when the referrer's total in one currency reaches
 * `referralMinimum` ($20). A friend who pays with a card of the referrer ends the invite (`#block`).
 */
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

  /**
   * The invite coupon for a Checkout of this account, or null when the account has no referrer. A Stripe
   * failure gives null: the Checkout opens without the discount and does not fail.
   */
  readonly couponFor = Effect.fn("BillingReferral.couponFor")(function* (
    this: BillingReferral,
    userId: string,
  ): Effect.fn.Return<string | null, Failure> {
    if (!(yield* this.#referrals.isReferred(userId))) return null;
    return yield* this.#stripe
      .ensureReferralCoupon({
        id: REFERRAL_COUPON_ID,
        percentOff: REFERRAL_SHARE_PERCENT,
        name: `Invite: ${REFERRAL_SHARE_PERCENT}% off`,
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

  /** The credit that Stripe takes off the next invoice of the account, for each currency. */
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

  /**
   * Applies an `invoice.paid` event or a refund or dispute of a paid invoice; other events change nothing.
   * Each change is written to D1 before it goes to Stripe with a fixed idempotency key, so a repeated
   * event gives no second credit. A failure makes Stripe send the event again.
   */
  readonly record = Effect.fn("BillingReferral.record")(function* (
    this: BillingReferral,
    event: StripeEvent,
    payment: { invoiceId: string; total: number | null; totalExcludingTax: number | null } | null,
    /** The account that owns the subscription of the event, or null. */
    ownerId: string | null,
  ): Effect.fn.Return<void, Failure> {
    if (event.type === "invoice.paid") return yield* this.#creditInvoice(event);
    const reversal = paymentReversal(event);
    if (reversal && payment && (reversal.type === "payment_refunded" || reversal.type === "dispute_lost")) {
      yield* this.#reverse(reversal, payment, ownerId);
    }
  }).bind(this);

  readonly #creditInvoice = Effect.fn("BillingReferral.creditInvoice")(function* (
    this: BillingReferral,
    event: StripeEvent,
  ): Effect.fn.Return<void, Failure> {
    const decoded = Schema.decodeUnknownOption(paidInvoiceSchema)(event.data.object);
    if (Option.isNone(decoded)) return;
    const invoice = decoded.value;
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
      // A blocked friend can still have the coupon on another plan; its next invoice takes it off.
      if (pair.blocked_at !== null || (yield* this.#sameCard(pair.referrer, invoice.customer))) {
        const subscription = invoice.parent.subscription_details.subscription;
        return yield* this.#block(pair.friend, typeof subscription === "string" ? subscription : subscription.id);
      }
      const customerId = yield* this.#ensureCustomer({ id: pair.referrer, email: pair.email });
      const customer = yield* this.#stripeCall(() => this.#stripe.getCustomerCredit(customerId));
      // Stripe keeps one credit for each currency. The referrer's own currency is the one that its next
      // invoice uses.
      const currency: BillingCurrency =
        customer?.currency && isOneOf(BILLING_CURRENCIES, customer.currency) ? customer.currency : sourceCurrency;
      // A share that converts to 0 still writes its row: a refund of this invoice then finds it, and the
      // payment counts toward the friend's second payment.
      const amount = convertReferralAmount(share, sourceCurrency, currency);
      yield* billingCall(() =>
        this.#database
          .prepare(
            `INSERT OR IGNORE INTO referral_credits(
               invoice_id, referrer_user_id, referred_user_id, source_currency, source_amount, currency, amount, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(invoice.id, pair.referrer, pair.friend, sourceCurrency, share, currency, amount, this.#now())
          .run(),
      );
      row = yield* this.#creditRow(invoice.id);
    }
    if (!row) return;
    const friend = row.referred_user_id;
    const progress = yield* billingCall(() =>
      this.#database
        .prepare(
          `SELECT COUNT(*) AS payments, COUNT(released_at) AS released
           FROM referral_credits WHERE referred_user_id = ?`,
        )
        .bind(friend)
        .first<{ payments: number; released: number }>(),
    );
    // The first renewal after an earlier payment ends the wait. A renewal after a trial is the first payment,
    // and a plan change or a second plan in the first month does not end it.
    const released =
      (progress?.released ?? 0) > 0 ||
      (invoice.billing_reason === "subscription_cycle" && (progress?.payments ?? 0) >= 2);
    if (released) {
      yield* billingCall(() =>
        this.#database
          .prepare("UPDATE referral_credits SET released_at = ?2 WHERE referred_user_id = ?1 AND released_at IS NULL")
          .bind(friend, this.#now())
          .run(),
      );
    }
    // A repeated event also gets here, so a send that failed before finishes.
    yield* this.#sendReady(row.referrer_user_id);
  }).bind(this);

  /**
   * True when the friend paid with a card that the referrer also saved or paid with: one person with two
   * accounts. A referrer with no Stripe customer has no card.
   */
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

  /**
   * Ends the invite of a friend who paid with a card of the referrer. The coupon goes off the plan first, so
   * a Stripe failure makes Stripe send the event again. The friend's waiting credit never goes to Stripe;
   * queued credit is on its way and credit that Stripe has stays.
   */
  readonly #block = Effect.fn("BillingReferral.block")(function* (
    this: BillingReferral,
    friend: string,
    subscriptionId: string,
  ): Effect.fn.Return<void, Failure> {
    yield* this.#stripeCall(() => this.#stripe.removeSubscriptionCoupon(subscriptionId, REFERRAL_COUPON_ID));
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

  /**
   * Sends the released credit of the referrer in each currency where it reached `referralMinimum`. The rows
   * are queued first, so a send that fails finishes at the next event even if a refund takes the total
   * below the minimum.
   */
  readonly #sendReady = Effect.fn("BillingReferral.sendReady")(function* (
    this: BillingReferral,
    referrer: string,
  ): Effect.fn.Return<void, Failure> {
    yield* this.#followReferrerCurrency(referrer);
    const totals = yield* billingCall(() =>
      this.#database
        .prepare(
          `SELECT currency, SUM(amount - reversed_amount) AS amount FROM referral_credits
           WHERE referrer_user_id = ? AND released_at IS NOT NULL AND queued_at IS NULL
             AND balance_transaction_id IS NULL
           GROUP BY currency`,
        )
        .bind(referrer)
        .all<{ currency: string; amount: number }>(),
    );
    const full: BillingCurrency[] = [];
    for (const total of totals.results ?? []) {
      if (isOneOf(BILLING_CURRENCIES, total.currency) && total.amount >= referralMinimum(total.currency)) {
        full.push(total.currency);
      }
    }
    if (full.length > 0) {
      yield* billingCall(() =>
        this.#database
          .prepare(
            `UPDATE referral_credits SET queued_at = ?2
             WHERE referrer_user_id = ?1 AND released_at IS NOT NULL AND queued_at IS NULL
               AND balance_transaction_id IS NULL AND currency IN (SELECT value FROM json_each(?3))`,
          )
          .bind(referrer, this.#now(), JSON.stringify(full))
          .run(),
      );
    }
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

  /**
   * A referrer with no Stripe currency gets credit in the friend's currency. A plan that the referrer starts
   * later sets the currency of its Stripe customer, and Stripe takes credit only off invoices in that
   * currency. Credit that is not queued yet moves to that currency, with its waiting refunds.
   */
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
      // The batch is one transaction. The guards on the old currency keep a second webhook at the same time
      // from converting the row and its refunds twice.
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

  /** Gives one credit to the referrer, less the part that a refund took back while it waited. */
  readonly #send = Effect.fn("BillingReferral.send")(function* (
    this: BillingReferral,
    credit: CreditRow,
  ): Effect.fn.Return<void, Failure> {
    const amount = credit.amount - credit.reversed_amount;
    // A refund that took all of it back leaves nothing for Stripe.
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
    let credit = yield* this.#creditRow(payment.invoiceId);
    const share = referralShare(withoutTax(reversal.amount, payment.total, payment.totalExcludingTax));
    // Stripe does not keep the order of events, and sends a failed `invoice.paid` again later. A refund of an
    // invoice of an invited friend that has no credit yet fails, so Stripe sends the refund again after the
    // credit is written. Otherwise the referrer would keep credit for a refunded payment. A refund is not
    // more than its payment, so a refund with a share of 0 is of an invoice that gives no credit row.
    if (!credit && share > 0 && ownerId && (yield* this.#referrals.isReferred(ownerId))) {
      return yield* new BillingOperationError({});
    }
    // A queued credit keeps its amount until Stripe accepts it, because its idempotency key is fixed. It goes
    // to Stripe first, and the refund then takes the share back from the Stripe credit.
    if (credit && credit.queued_at !== null && credit.balance_transaction_id === null) {
      yield* this.#send(credit);
      credit = yield* this.#creditRow(payment.invoiceId);
    }
    if (!credit || !isOneOf(BILLING_CURRENCIES, credit.source_currency)) return;
    if (!isOneOf(BILLING_CURRENCIES, credit.currency)) return;
    if (credit.balance_transaction_id === null) {
      // The credit still waits: it gets smaller, and nothing goes to Stripe.
      const amount = Math.max(
        0,
        Math.min(
          convertReferralAmount(share, credit.source_currency, credit.currency),
          credit.amount - credit.reversed_amount,
        ),
      );
      // The guard writes nothing when another webhook queued, sent or converted the credit after the read.
      // Then this refund fails, and the retry takes the share back from the credit as it is then.
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
    // A refund of all of a waiting credit leaves nothing to take back.
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
          // Nothing to take back is done at once.
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

  /**
   * Sets the credit that refunds took back to the sum of the finished reversals: the ones that Stripe
   * accepted and the ones of a credit that waited. A repeated update gives the same value.
   */
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
