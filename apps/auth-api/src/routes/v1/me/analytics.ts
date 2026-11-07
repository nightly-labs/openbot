import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { readAnalyticsAnswer } from "../../../server/auth-service";
import { runApiResponse } from "../../../server/effect-runtime";
import { readJsonObject } from "../../../server/json-body";
import { apiError, authErrorResponse, bearerToken, json, requestAuthService } from "../../../server/request-auth";

export const Route = createFileRoute("/v1/me/analytics")({
  server: {
    handlers: {
      PUT: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const token = bearerToken(request);
            if (!token) return apiError(401, "unauthorized", "Sign in is required.");
            const answer = readAnalyticsAnswer(yield* readJsonObject(request));
            if (!answer) return apiError(400, "invalid_analytics_preference", "The analytics setting is not valid.");
            return json(yield* requestAuthService().updateAnalytics(token, answer));
          }),
          authErrorResponse,
        ),
    },
  },
});
