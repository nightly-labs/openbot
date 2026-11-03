import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../../server/effect-runtime";
import {
  apiError,
  companySignInErrorResponse,
  json,
  requestCompanySignIn,
  requestUser,
} from "../../../../../../server/request-auth";

// The SCIM token of a server's company sign-in. The answer shows a new token once.
export const Route = createFileRoute("/v2/remote/hosts/$hostId/company-sign-in/scim-token")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            return json(yield* requestCompanySignIn().createScimToken(user, params.hostId));
          }),
          companySignInErrorResponse,
        ),
      DELETE: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            yield* requestCompanySignIn().revokeScimToken(user, params.hostId);
            return new Response(null, { status: 204 });
          }),
          companySignInErrorResponse,
        ),
    },
  },
});
