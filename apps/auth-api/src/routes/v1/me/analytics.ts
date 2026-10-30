import { isBoolean } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
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
            const body = yield* readJsonObject(request);
            if (!isBoolean(body.enabled)) {
              return apiError(400, "invalid_analytics_preference", "The analytics setting is not valid.");
            }
            return json(yield* requestAuthService().updateAnalytics(token, body.enabled));
          }),
          authErrorResponse,
        ),
    },
  },
});
