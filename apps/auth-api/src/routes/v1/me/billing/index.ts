import { createFileRoute } from "@tanstack/solid-router";
import { BILLING_UNAVAILABLE_STATE } from "../../../../server/billing-service";
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
          const user = await requestUser(request);
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          const billing = requestBillingService();
          return json(billing ? await billing.getState(user.id) : BILLING_UNAVAILABLE_STATE);
        } catch (error) {
          return billingErrorResponse(error);
        }
      },
    },
  },
});
