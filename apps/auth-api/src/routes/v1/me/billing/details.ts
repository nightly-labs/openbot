import { parseBillingDetailsRequest } from "@openbot/contracts/billing-details";
import { sourceText } from "@openbot/i18n/source";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { withSuggestedCountry } from "../../../../server/billing-tax";
import { runApiResponse } from "../../../../server/effect-runtime";
import { readJsonObject } from "../../../../server/json-body";
import {
  apiError,
  billingErrorResponse,
  json,
  requestBillingService,
  requestUser,
} from "../../../../server/request-auth";

export const Route = createFileRoute("/v1/me/billing/details")({
  server: {
    handlers: {
      GET: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const billing = requestBillingService();
            if (!billing) return apiError(503, "billing_unavailable", "Billing is not available.");
            return json(withSuggestedCountry(yield* billing.getBillingDetails(user.id), request));
          }),
          billingErrorResponse,
        ),
      PUT: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const billing = requestBillingService();
            if (!billing) return apiError(503, "billing_unavailable", "Billing is not available.");
            const input = parseBillingDetailsRequest(yield* readJsonObject(request));
            if (!input) return apiError(400, "invalid_billing_details", sourceText("error.billing.detailsInvalid"));
            return json(yield* billing.setBillingDetails(user, input));
          }),
          billingErrorResponse,
        ),
    },
  },
});
