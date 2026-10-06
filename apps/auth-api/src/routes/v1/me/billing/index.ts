import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { BILLING_UNAVAILABLE_STATE } from "../../../../server/billing-service";
import { runApiResponse } from "../../../../server/effect-runtime";
import {
  apiError,
  billingErrorResponse,
  json,
  requestBillingService,
  requestUser,
} from "../../../../server/request-auth";

export const Route = createFileRoute("/v1/me/billing/")({
  server: {
    handlers: {
      GET: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const billing = requestBillingService();
            return json(billing ? yield* billing.getState(user.id) : BILLING_UNAVAILABLE_STATE);
          }),
          billingErrorResponse,
        ),
    },
  },
});
