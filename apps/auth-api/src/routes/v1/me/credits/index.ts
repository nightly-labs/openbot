import { CREDITS_UNAVAILABLE_STATE } from "@openbot/contracts/credits";
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

export const Route = createFileRoute("/v1/me/credits/")({
  server: {
    handlers: {
      GET: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const billing = requestBillingService();
            return json(billing ? yield* billing.credits.getState(user.id) : CREDITS_UNAVAILABLE_STATE);
          }),
          billingErrorResponse,
        ),
    },
  },
});
