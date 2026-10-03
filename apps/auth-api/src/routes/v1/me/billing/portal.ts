import { parseBillingPortalRequest } from "@openbot/contracts/billing";
import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../../server/effect-runtime";
import { readJsonObject } from "../../../../server/json-body";
import {
  apiError,
  billingErrorResponse,
  json,
  requestBillingService,
  requestUser,
} from "../../../../server/request-auth";

export const Route = createFileRoute("/v1/me/billing/portal")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const user = await runApiEffect(requestUser(request));
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          const billing = requestBillingService();
          if (!billing) return apiError(503, "billing_unavailable", "Billing is not available.");
          const input = parseBillingPortalRequest(await readJsonObject(request));
          if (!input) return apiError(400, "invalid_billing_request", "The billing request is invalid.");
          const url = await runApiEffect(billing.createPortal(user.id, input, "desktop", new URL(request.url).origin));
          return json({ url });
        } catch (error) {
          return billingErrorResponse(error);
        }
      },
    },
  },
});
