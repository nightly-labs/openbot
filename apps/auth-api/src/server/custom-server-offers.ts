import {
  CUSTOM_SERVER_PAID_STATUSES,
  type CustomServerCheckout,
  type CustomServerPlan,
  parseCustomServerPlan,
} from "@openbot/contracts/custom-server-plans";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { BillingError, type BillingOperationError, billingCall } from "./billing-errors";
import type { BillingReturnTarget, BillingService } from "./billing-service";
import type { AuthUser } from "./types";

export interface CustomServerOfferRow {
  plan_name: string | null;
  amount: number | null;
  currency: string | null;
  billing_interval: string | null;
  vcpu: number | null;
  memory_gb: number | null;
  storage_gb: number | null;
  personalized_support: number | null;
  subscription_status: string | null;
}

interface CheckoutRow extends CustomServerOfferRow {
  checkout_session_id: string | null;
}

export const CUSTOM_SERVER_OFFER_COLUMNS =
  "o.plan_name, o.amount, o.currency, o.billing_interval, o.vcpu, o.memory_gb, o.storage_gb, o.personalized_support, o.subscription_status";

function customServerPlanOf(row: CustomServerOfferRow): CustomServerPlan | null {
  return parseCustomServerPlan({
    name: row.plan_name,
    amount: row.amount,
    currency: row.currency,
    interval: row.billing_interval,
    vcpu: row.vcpu,
    memoryGb: row.memory_gb,
    storageGb: row.storage_gb,
    personalizedSupport: row.personalized_support === 1,
  });
}

function customServerPaid(status: string | null): boolean {
  return isOneOf(CUSTOM_SERVER_PAID_STATUSES, status);
}

export function customServerPayment(
  row: CustomServerOfferRow,
  role: string,
): { paymentRequired?: true; customPlan?: CustomServerPlan } {
  if (customServerPaid(row.subscription_status)) return {};
  const plan = customServerPlanOf(row);
  if (!plan) return {};
  return role === "owner" ? { paymentRequired: true, customPlan: plan } : { paymentRequired: true };
}

function offerNotFound(): BillingError {
  return new BillingError(404, "custom_server_offer_not_found", sourceText("error.billing.customServerOfferMissing"));
}

function billingUnavailable(): BillingError {
  return new BillingError(503, "billing_unavailable", sourceText("error.billing.checkoutUnavailable"));
}

export class CustomServerOffers {
  readonly #database: D1Database;
  readonly #billing: BillingService | null;
  readonly #now: () => number;

  constructor(options: { database: D1Database; billing: BillingService | null; now?: () => number }) {
    this.#database = options.database;
    this.#billing = options.billing;
    this.#now = options.now ?? Date.now;
  }

  readonly checkout = Effect.fn("CustomServerOffers.checkout")(function* (
    this: CustomServerOffers,
    user: AuthUser,
    hostId: string,
    returnTo: { target: BillingReturnTarget; origin: string },
    input: { earlyStart?: unknown },
  ): Effect.fn.Return<CustomServerCheckout, BillingError | BillingOperationError> {
    const billing = this.#billing;
    if (!billing) return yield* billingUnavailable();
    const row = yield* this.#ownedOffer(user.id, hostId);
    if (!row) return yield* offerNotFound();
    if (customServerPaid(row.subscription_status)) return { checkoutUrl: null };
    const plan = customServerPlanOf(row);
    if (!plan) return yield* offerNotFound();
    const previous = row.checkout_session_id;
    if (previous) {
      const closed = yield* billing.closeCheckout(previous);
      if (closed.status === "paid") return { checkoutUrl: null };
    }
    const session = yield* billing.createCustomServerCheckout({
      user: { id: user.id, email: user.email },
      serverId: hostId,
      plan,
      target: returnTo.target,
      origin: returnTo.origin,
      ...(input.earlyStart === true ? { earlyStartAt: this.#now() } : {}),
    });
    const stored = yield* billingCall(() =>
      this.#database
        .prepare(
          "UPDATE custom_server_offers SET checkout_session_id = ?, updated_at = ? WHERE host_id = ? AND checkout_session_id IS ?",
        )
        .bind(session.sessionId, this.#now(), hostId, previous)
        .run(),
    );
    if (stored.meta.changes !== 1) {
      yield* billing.closeCheckout(session.sessionId).pipe(Effect.ignore);
      return yield* new BillingError(409, "custom_server_conflict", sourceText("error.billing.checkoutUnavailable"));
    }
    return { checkoutUrl: session.url };
  });

  readonly #ownedOffer = Effect.fn("CustomServerOffers.ownedOffer")(function* (
    this: CustomServerOffers,
    userId: string,
    hostId: string,
  ): Effect.fn.Return<CheckoutRow | null, BillingError | BillingOperationError> {
    return yield* billingCall(() =>
      this.#database
        .prepare(
          `SELECT ${CUSTOM_SERVER_OFFER_COLUMNS}, o.checkout_session_id
             FROM custom_server_offers o
             JOIN remote_hosts h ON h.host_id = o.host_id
             JOIN remote_memberships m ON m.host_id = h.host_id
            WHERE o.host_id = ? AND m.user_id = ? AND m.role = 'owner' AND m.status = 'active'`,
        )
        .bind(hostId, userId)
        .first<CheckoutRow>(),
    );
  });
}
