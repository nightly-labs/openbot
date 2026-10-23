import { parseLicensePlanRequest } from "@openbot/contracts/license";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { readJsonObject } from "../../../../server/json-body";
import {
  apiError,
  billingErrorResponse,
  json,
  requestBillingService,
  requestUser,
} from "../../../../server/request-auth";

export const Route = createFileRoute("/v1/me/license/plan")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const billing = requestBillingService();
            if (!billing) return apiError(503, "billing_unavailable", "Billing is not available.");
            const input = parseLicensePlanRequest(yield* readJsonObject(request));
            if (!input) return apiError(400, "invalid_billing_request", "The billing request is invalid.");
            return json(yield* billing.license.changePlan(user.id, input));
          }),
          billingErrorResponse,
        ),
    },
  },
});
