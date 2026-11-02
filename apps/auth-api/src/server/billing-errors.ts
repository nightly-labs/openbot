import { Effect, Schema } from "effect";
import { StripeRequestError, type StripeTransportError } from "./stripe-client";

/** The statuses of a subscription that still gives its plan or license. */
export const OPEN_STATUSES_SQL = "('active', 'trialing', 'past_due', 'unpaid', 'paused')";

export class BillingError extends Schema.TaggedError<BillingError>()("BillingError", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
}) {
  constructor(status: number, code: string, message: string) {
    super({ status, code, message });
  }
}

export class BillingOperationError extends Schema.TaggedError<BillingOperationError>()("BillingOperationError", {}) {}

export function billingCall<A>(operation: () => Promise<A>): Effect.Effect<A, BillingError | BillingOperationError> {
  return Effect.tryPromise({
    try: operation,
    catch: (error) => (error instanceof BillingError ? error : new BillingOperationError({})),
  });
}

export function stripeRequest<A>(
  operation: () => Effect.Effect<A, StripeRequestError | StripeTransportError>,
): Effect.Effect<A, StripeRequestError | BillingOperationError> {
  return operation().pipe(
    Effect.mapError((error) => (error instanceof StripeRequestError ? error : new BillingOperationError({}))),
  );
}

export function stripeFailure(error: StripeRequestError | BillingOperationError): BillingError | BillingOperationError {
  if (!(error instanceof StripeRequestError)) return error;
  console.error("billing: Stripe request failed", error.message);
  return new BillingError(
    502,
    "payment_service_failed",
    "The payment service could not complete the request. Try again later.",
  );
}
