import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { ACCESS_TOKEN_ROUTE } from "../../server/access-tokens";
import { sessionReadsFor } from "../../server/auth-service";
import { runApiResponse } from "../../server/effect-runtime";
import {
  apiError,
  authErrorResponse,
  bearerCredential,
  json,
  requestAuthService,
  requestUser,
} from "../../server/request-auth";

export const Route = createFileRoute("/v1/me")({
  server: {
    handlers: {
      GET: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            if (!bearerCredential(request)) return apiError(401, "unauthorized", "Sign in is required.");
            const user = yield* requestUser(request, sessionReadsFor(request));
            if (!user) return apiError(401, "unauthorized", "The session is invalid.");
            return json(
              requestAuthService().issuesAccessTokens ? { ...user, accessTokenRoute: ACCESS_TOKEN_ROUTE } : user,
            );
          }),
          authErrorResponse,
        ),
    },
  },
});
