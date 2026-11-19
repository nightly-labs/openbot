import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { BillingError } from "../../../server/billing-service";
import { runApiResponse } from "../../../server/effect-runtime";
import { JSON_BODY_LIMIT, JsonBodyError, readRequestBytes } from "../../../server/json-body";
import { apiError, billingErrorResponse, json, requestBillingService } from "../../../server/request-auth";

const STRIPE_EVENT_LIMIT = 16 * JSON_BODY_LIMIT;

export const Route = createFileRoute("/v1/stripe/webhook")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const billing = requestBillingService();
            if (!billing) return apiError(503, "billing_unavailable", "Billing is not available.");
            const payload = new TextDecoder().decode(yield* readRequestBytes(request, STRIPE_EVENT_LIMIT));
            yield* billing.handleWebhook(payload, request.headers.get("Stripe-Signature"));
            return json({ received: true });
          }),
          (error) => {
            if (error instanceof BillingError || error instanceof JsonBodyError) return billingErrorResponse(error);
            console.error("billing: webhook failed", error instanceof Error ? error.name : "unknown");
            return apiError(500, "internal_error", "The webhook could not be applied.");
          },
        ),
    },
  },
});
