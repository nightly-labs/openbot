import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
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
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            yield* requestAuthService().enforceHostedServerClaimRateLimit(requestSourceIp(request));
            const body = yield* readJsonObject(request);
            return json(yield* requestHostedServerService().redeemClaim(body.claim));
          }),
          hostedServerErrorResponse,
        ),
    },
  },
});
