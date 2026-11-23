import { EMPTY_CREDIT_ACTIVITY } from "@openbot/contracts/credits";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import {
  apiError,
  billingErrorResponse,
  json,
  requestBillingService,
  requestUser,
} from "../../../../server/request-auth";

export const Route = createFileRoute("/v1/me/credits/activity")({
  server: {
    handlers: {
      GET: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const billing = requestBillingService();
            return json(billing ? yield* billing.credits.activity(user.id) : EMPTY_CREDIT_ACTIVITY);
          }),
          billingErrorResponse,
        ),
    },
  },
});
