import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { BillingError } from "../../../server/billing-service";
import { runApiResponse } from "../../../server/effect-runtime";
import { JSON_BODY_LIMIT, JsonBodyError, readRequestBytes } from "../../../server/json-body";
import { apiError, billingErrorResponse, json, requestBillingService } from "../../../server/request-auth";

/** Stripe event bodies are small; a larger body is not a Stripe event. */
const STRIPE_EVENT_LIMIT = 16 * JSON_BODY_LIMIT;

export const Route = createFileRoute("/v1/stripe/webhook")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const billing = requestBillingService();
            if (!billing) return apiError(503, "billing_unavailable", "Billing is not available.");
            // The signature covers the exact bytes, so the body is read as text before it is decoded.
            const payload = new TextDecoder().decode(yield* readRequestBytes(request, STRIPE_EVENT_LIMIT));
            yield* billing.handleWebhook(payload, request.headers.get("Stripe-Signature"));
            return json({ received: true });
          }),
          (error) => {
            // Stripe sends the event again after each answer that is not 2xx, for up to 3 days.
            if (error instanceof BillingError || error instanceof JsonBodyError) return billingErrorResponse(error);
            console.error("billing: webhook failed", error instanceof Error ? error.name : "unknown");
            return apiError(500, "internal_error", "The webhook could not be applied.");
          },
        ),
    },
  },
});
