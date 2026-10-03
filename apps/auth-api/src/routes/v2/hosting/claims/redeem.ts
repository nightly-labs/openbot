import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../../server/effect-runtime";
import { readJsonObject } from "../../../../server/json-body";
import {
  hostedServerErrorResponse,
  json,
  requestAuthService,
  requestHostedServerService,
  requestSourceIp,
} from "../../../../server/request-auth";

/** A new hosted server exchanges its claim for the owner's account session. */
export const Route = createFileRoute("/v2/hosting/claims/redeem")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await runApiEffect(requestAuthService().enforceHostedServerClaimRateLimit(requestSourceIp(request)));
          const body = await readJsonObject(request);
          return json(await runApiEffect(requestHostedServerService().redeemClaim(body.claim)));
        } catch (error) {
          return hostedServerErrorResponse(error);
        }
      },
    },
  },
});
