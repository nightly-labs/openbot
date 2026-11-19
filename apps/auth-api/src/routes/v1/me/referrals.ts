import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { inviteLinkOrigin } from "../../../server/canonical-redirect";
import { runApiResponse } from "../../../server/effect-runtime";
import { referralPageQuery, referralState } from "../../../server/referrals";
import {
  apiError,
  billingErrorResponse,
  json,
  requestBillingService,
  requestReferrals,
  requestUser,
} from "../../../server/request-auth";

/** Invite friends: the invite link, the credit, the friend counts and one page of friends. */
export const Route = createFileRoute("/v1/me/referrals")({
  server: {
    handlers: {
      GET: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const billing = requestBillingService();
            const url = new URL(request.url);
            return json(
              yield* referralState(
                requestReferrals(),
                billing ? (userId) => billing.referralCredit(userId) : null,
                user.id,
                referralPageQuery(url),
                inviteLinkOrigin(url),
              ),
            );
          }),
          billingErrorResponse,
        ),
    },
  },
});
