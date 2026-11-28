import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { apiError, authErrorResponse, bearerToken, json, requestAuthService } from "../../../server/request-auth";

export const Route = createFileRoute("/v1/auth/access-token")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const service = requestAuthService();
            if (!service.issuesAccessTokens) return apiError(404, "not_found", "The route was not found.");
            const token = bearerToken(request);
            if (!token) return apiError(401, "unauthorized", "Sign in is required.");
            return json(yield* service.issueAccessToken(token));
          }),
          authErrorResponse,
        ),
    },
  },
});
