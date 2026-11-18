import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { apiError, authErrorResponse, json, requestAuthService, requestUser } from "../../../server/request-auth";

/** The signed-in user makes a one-time claim that signs a new server in to the same account. */
export const Route = createFileRoute("/v2/server-claims/")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            return json(yield* requestAuthService().createServerClaimForUser(user.id));
          }),
          authErrorResponse,
        ),
    },
  },
});
