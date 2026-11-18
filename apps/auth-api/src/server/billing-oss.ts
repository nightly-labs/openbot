import { isBillingAmount } from "@openbot/contracts/billing";
import { isEuVatCountry, VAT_SELLER_COUNTRY } from "@openbot/contracts/billing-details";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { Effect, Option, Schema } from "effect";
import { type BillingError, BillingOperationError, billingCall } from "./billing-errors";
import { withoutTax } from "./billing-sales";
import { BillingUsd, type BillingUsdCurrency } from "./billing-usd";
import type { StripeEvent } from "./stripe-client";

/**
 * The yearly sales to consumers in other EU countries that start the operator alert, in euro cents. The EU
 * limit is EUR 10,000 (Article 59c of the VAT Directive). Above it, the seller must charge the VAT of the
 * buyer's country, through the One Stop Shop, and no longer Polish VAT. The alert comes first, so that
 * there is time to register.
 */
const OSS_ALERT_EUR = 900_000;
const OSS_LIMIT_EUR = 1_000_000;
const CURRENCIES: readonly BillingUsdCurrency[] = ["eur", "usd", "pln", "brl"];
/** USD per euro is read with a large amount, so that the rounding to cents changes nothing. */
const EUR_PROBE = 100_000_000;

const paidInvoiceSchema = Schema.Struct({
  id: Schema.String,
  currency: Schema.String,
  amount_paid: Schema.Number,
  total: Schema.optional(Schema.NullOr(Schema.Number)),
  total_excluding_tax: Schema.optional(Schema.NullOr(Schema.Number)),
  customer_tax_exempt: Schema.optional(Schema.NullOr(Schema.String)),
  customer_address: Schema.optional(
    Schema.NullOr(Schema.Struct({ country: Schema.optional(Schema.NullOr(Schema.String)) })),
  ),
});

/**
 * Counts the paid invoices of consumers in EU countries other than Poland, and alerts the operator once in
 * a calendar year when their net total reaches `OSS_ALERT_EUR`. A company with reverse charge does not
 * count, and a buyer in Poland or outside the EU does not count. A refund does not lower the total: the
 * alert can only come early.
 */
export class BillingOss {
  readonly #database: D1Database;
  readonly #usd: BillingUsd;
  readonly #alert: (text: string) => void;

  constructor(options: {
    database: D1Database;
    fetch: (input: string, init: RequestInit) => Promise<Response>;
    /** Sends the operator text. It must not throw or wait. */
    alert: (text: string) => void;
  }) {
    this.#database = options.database;
    this.#usd = new BillingUsd({ database: options.database, fetch: options.fetch });
    this.#alert = options.alert;
  }

  /**
   * Records an `invoice.paid` event; other events change nothing. It is safe to run again for the same
   * event: the invoice and the alert of a year are each written once. A failure makes Stripe send the
   * event again.
   */
  readonly record = Effect.fn("BillingOss.record")(function* (
    this: BillingOss,
    event: StripeEvent,
  ): Effect.fn.Return<void, BillingError | BillingOperationError> {
    if (event.type !== "invoice.paid") return;
    const invoice = Schema.decodeUnknownOption(paidInvoiceSchema)(event.data.object);
    if (Option.isNone(invoice)) return;
    const { id, amount_paid, total, total_excluding_tax, customer_tax_exempt } = invoice.value;
    const country = invoice.value.customer_address?.country ?? null;
    const currency = invoice.value.currency.toLowerCase();
    if (!country || !isEuVatCountry(country) || country === VAT_SELLER_COUNTRY) return;
    if (customer_tax_exempt === "reverse" || customer_tax_exempt === "exempt") return;
    if (!isBillingAmount(amount_paid) || amount_paid === 0 || !isOneOf(CURRENCIES, currency)) return;
    const net = withoutTax(amount_paid, total, total_excluding_tax);
    const amountEur = yield* this.#toEur(net, currency, event.created);
    const year = new Date(event.created * 1000).getUTCFullYear();
    const now = Date.now();
    yield* billingCall(() =>
      this.#database.batch([
        this.#database
          .prepare(
            "INSERT OR IGNORE INTO billing_vat_oss_sales(invoice_id, year, country, amount_eur, paid_at) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(id, year, country, amountEur, event.created * 1000),
        // The limit reads the current and the previous year.
        this.#database.prepare("DELETE FROM billing_vat_oss_sales WHERE year < ?").bind(year - 1),
      ]),
    );
    const sum = yield* billingCall(() =>
      this.#database
        .prepare("SELECT COALESCE(SUM(amount_eur), 0) AS total FROM billing_vat_oss_sales WHERE year = ?")
        .bind(year)
        .first<{ total: number }>(),
    );
    const totalEur = sum?.total ?? 0;
    if (totalEur < OSS_ALERT_EUR) return;
    const claim = yield* billingCall(() =>
      this.#database
        .prepare("INSERT OR IGNORE INTO billing_vat_oss_alerts(year, total_eur, alerted_at) VALUES (?, ?, ?)")
        .bind(year, totalEur, now)
        .run(),
    );
    if (claim.meta.changes !== 1) return;
    const text = ossAlertText(year, totalEur);
    console.warn(`billing: ${text}`);
    this.#alert(text);
  }).bind(this);

  readonly #toEur = Effect.fn("BillingOss.toEur")(function* (
    this: BillingOss,
    amount: number,
    currency: BillingUsdCurrency,
    created: number,
  ): Effect.fn.Return<number, BillingOperationError> {
    if (currency === "eur") return amount;
    const failed = () => new BillingOperationError({});
    const usd = yield* this.#usd.convert(amount, currency, created).pipe(Effect.mapError(failed));
    const usdPerEur = yield* this.#usd.convert(EUR_PROBE, "eur", created).pipe(Effect.mapError(failed));
    if (usdPerEur.amountUsd <= 0) return yield* failed();
    return Math.round((usd.amountUsd * EUR_PROBE) / usdPerEur.amountUsd);
  }).bind(this);
}

function euro(cents: number): string {
  return new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function ossAlertText(year: number, totalEur: number): string {
  return `VAT limit: in ${year}, sales to consumers in other EU countries reached ${euro(totalEur)} (net). Above ${euro(OSS_LIMIT_EUR)} a year, OpenBot must charge the VAT of the buyer's country through the One Stop Shop, not Polish VAT. Register for OSS and change the VAT before the limit.`;
}
