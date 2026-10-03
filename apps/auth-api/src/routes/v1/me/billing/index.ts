import { createFileRoute } from "@tanstack/solid-router";
import { BILLING_UNAVAILABLE_STATE } from "../../../../server/billing-service";
import { runApiEffect } from "../../../../server/effect-runtime";
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
      GET: async ({ request }) => {
        try {
          const user = await runApiEffect(requestUser(request));
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          const billing = requestBillingService();
          return json(billing ? await runApiEffect(billing.getState(user.id)) : BILLING_UNAVAILABLE_STATE);
        } catch (error) {
          return billingErrorResponse(error);
        }
      },
    },
  },
});
