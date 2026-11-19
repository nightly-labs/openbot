import {
  type BillingDetails,
  type BillingDetailsRequest,
  isBillingCountry,
  isEuVatCountry,
  VAT_SELLER_COUNTRY,
  VAT_TAX_RATE,
  vatIdPrefix,
} from "@openbot/contracts/billing-details";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Option, Schema } from "effect";
import { BillingError, type BillingOperationError, stripeFailure, stripeRequest } from "./billing-errors";
import { requestCountry } from "./request-country";
import {
  type StripeClient,
  type StripeCustomerTax,
  type StripeEvent,
  type StripeRequestError,
  type StripeTransportError,
  VAT_METADATA,
} from "./stripe-client";
import type { ViesClient } from "./vies-client";

export type VatTreatment = "standard" | "reverse" | "none";

export interface CheckoutTax {
  rateId: string | null;
  country: string;
  treatment: VatTreatment;
}

const CUSTOMER_METADATA = {
  vatId: "openbot_vat_id",
  viesRequest: "openbot_vies_request",
  checkedAt: "openbot_vat_checked_at",
} as const;

export function vatTreatment(country: string, validVatId: boolean): VatTreatment {
  if (!isEuVatCountry(country)) return "none";
  if (country === VAT_SELLER_COUNTRY || !validVatId) return "standard";
  return "reverse";
}

function confirmedVatId(tax: StripeCustomerTax): string | null {
  if (!tax.country || !isEuVatCountry(tax.country)) return null;
  const prefix = vatIdPrefix(tax.country);
  const ids = tax.taxIds.filter((id) => id.type === "eu_vat" && id.value.startsWith(prefix));
  const recorded = tax.metadata[CUSTOMER_METADATA.vatId];
  const checked =
    ids.find((id) => id.value === recorded) ?? ids.find((id) => id.verification?.status === "verified") ?? null;
  if (checked) return checked.value;
  return tax.country === VAT_SELLER_COUNTRY ? (ids[0]?.value ?? null) : null;
}

export function billingDetailsOf(tax: StripeCustomerTax | null): BillingDetails {
  if (!tax || tax.deleted) return { country: null, vatId: null };
  return { country: isBillingCountry(tax.country) ? tax.country : null, vatId: confirmedVatId(tax) };
}

export function withSuggestedCountry(details: BillingDetails, request: Request): BillingDetails {
  const located = requestCountry(request);
  return details.country === null && isBillingCountry(located) ? { ...details, suggestedCountry: located } : details;
}

const stripeCall = <A>(call: () => Effect.Effect<A, StripeRequestError | StripeTransportError>) =>
  stripeRequest(call).pipe(Effect.mapError(stripeFailure));

export const checkoutTax = Effect.fn("BillingTax.checkoutTax")(function* (
  stripe: StripeClient,
  customerId: string,
  countryRequired: boolean,
): Effect.fn.Return<CheckoutTax | null, BillingError | BillingOperationError> {
  const tax = yield* stripeCall(() => stripe.getCustomerTax(customerId));
  if (!tax.country || !isBillingCountry(tax.country)) {
    if (!countryRequired) return null;
    return yield* new BillingError(409, "billing_country_required", sourceText("error.billing.countryRequired"));
  }
  const treatment = vatTreatment(tax.country, confirmedVatId(tax) !== null);
  const rateId =
    treatment === "standard"
      ? yield* stripeCall(() => stripe.findTaxRate(VAT_TAX_RATE.metadataKey, VAT_TAX_RATE.metadataValue))
      : null;
  if (treatment === "standard" && !rateId) {
    console.error("billing: the standard VAT Tax Rate is missing; run scripts/stripe-bootstrap.ts");
    return yield* new BillingError(503, "vat_unavailable", sourceText("error.billing.vatUnavailable"));
  }
  const taxExempt = treatment === "reverse" ? "reverse" : "none";
  if (tax.taxExempt !== taxExempt)
    yield* stripeCall(() => stripe.setCustomerTax(customerId, { taxExempt, metadata: {} }));
  return { rateId, country: tax.country, treatment };
});

export const setCustomerBillingDetails = Effect.fn("BillingTax.setCustomerBillingDetails")(function* (
  stripe: StripeClient,
  vies: ViesClient,
  customerId: string,
  request: BillingDetailsRequest,
  now: number,
): Effect.fn.Return<{ details: BillingDetails; vatChanges: readonly string[] }, BillingError | BillingOperationError> {
  const vatId = request.vatId ?? null;
  const check =
    vatId && vatTreatment(request.country, true) === "reverse"
      ? yield* vies
          .check(vatId)
          .pipe(
            Effect.mapError(
              () => new BillingError(503, "vat_id_unverified", sourceText("error.billing.vatIdUnverified")),
            ),
          )
      : null;
  if (check && !check.valid)
    return yield* new BillingError(400, "vat_id_invalid", sourceText("error.billing.vatIdInvalid"));
  const tax = yield* stripeCall(() => stripe.getCustomerTax(customerId));
  for (const id of tax.taxIds) {
    if (id.type === "eu_vat" && id.value !== vatId)
      yield* stripeCall(() => stripe.deleteCustomerTaxId(customerId, id.id));
  }
  if (vatId && !tax.taxIds.some((id) => id.type === "eu_vat" && id.value === vatId))
    yield* stripeCall(() => stripe.addCustomerVatId(customerId, vatId));
  const treatment = vatTreatment(request.country, check?.valid === true);
  yield* stripeCall(() =>
    stripe.setCustomerTax(customerId, {
      ...(tax.country === request.country ? {} : { country: request.country }),
      taxExempt: treatment === "reverse" ? "reverse" : "none",
      metadata: {
        [CUSTOMER_METADATA.vatId]: check ? (vatId ?? "") : "",
        [CUSTOMER_METADATA.viesRequest]: check?.requestIdentifier ?? "",
        [CUSTOMER_METADATA.checkedAt]: check ? new Date(now).toISOString() : "",
      },
    }),
  );
  const changed = yield* syncSubscriptionTax(stripe, customerId, treatment);
  const vatChanges = changed.map(
    (subscription) =>
      `VAT check: customer ${customerId} changed its billing details from ${tax.country ?? "no country"} to ${request.country}, so subscription ${subscription.id} changed from ${subscription.from} to ${treatment} VAT from its next invoice. Check the country.`,
  );
  return { details: { country: request.country, vatId }, vatChanges };
});

const OPEN_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

const syncSubscriptionTax = Effect.fn("BillingTax.syncSubscriptionTax")(function* (
  stripe: StripeClient,
  customerId: string,
  treatment: VatTreatment,
): Effect.fn.Return<readonly { id: string; from: string }[], BillingError | BillingOperationError> {
  const subscriptions = (yield* stripeCall(() => stripe.listCustomerSubscriptions(customerId))).filter(
    (subscription) =>
      OPEN_SUBSCRIPTION_STATUSES.has(subscription.status) &&
      !subscription.automatic_tax?.enabled &&
      subscription.metadata[VAT_METADATA.treatment] !== undefined,
  );
  if (subscriptions.length === 0) return [];
  const rateId =
    treatment === "standard"
      ? yield* stripeCall(() => stripe.findTaxRate(VAT_TAX_RATE.metadataKey, VAT_TAX_RATE.metadataValue))
      : null;
  if (treatment === "standard" && !rateId) {
    console.error("billing: the standard VAT Tax Rate is missing; run scripts/stripe-bootstrap.ts");
    return yield* new BillingError(503, "vat_unavailable", sourceText("error.billing.vatUnavailable"));
  }
  const rateIds = rateId ? [rateId] : [];
  const changed: { id: string; from: string }[] = [];
  for (const subscription of subscriptions) {
    const current = (subscription.default_tax_rates ?? []).map((rate) => rate.id);
    const sameRates = current.length === rateIds.length && current.every((id, index) => id === rateIds[index]);
    const from = subscription.metadata[VAT_METADATA.treatment] ?? "";
    if (sameRates && from === treatment) continue;
    yield* stripeCall(() => stripe.setSubscriptionTaxRates(subscription.id, rateIds, treatment));
    if (from !== treatment) changed.push({ id: subscription.id, from });
  }
  return changed;
});

const paidCheckoutSchema = Schema.Struct({
  id: Schema.String,
  metadata: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.String))),
  customer_details: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        address: Schema.optional(
          Schema.NullOr(Schema.Struct({ country: Schema.optional(Schema.NullOr(Schema.String)) })),
        ),
      }),
    ),
  ),
});

export function vatAlertText(text: string): string {
  return text.replace(/^(VAT check|VAT limit): /, "🧾 **$1** · ");
}

export function checkoutCountryMismatch(object: StripeEvent["data"]["object"]): string | null {
  const session = Schema.decodeUnknownOption(paidCheckoutSchema)(object);
  if (Option.isNone(session)) return null;
  const declared = session.value.metadata?.[VAT_METADATA.country];
  const paid = session.value.customer_details?.address?.country;
  if (!declared || !paid || declared === paid) return null;
  const treatment = session.value.metadata?.[VAT_METADATA.treatment] ?? "unknown";
  return `VAT check: Checkout page ${session.value.id} took the VAT of ${declared} (${treatment}), but its billing address is in ${paid}. Check the VAT of its invoice.`;
}
