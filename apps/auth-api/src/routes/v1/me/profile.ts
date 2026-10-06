import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { readJsonObject } from "../../../server/json-body";
import { apiError, authErrorResponse, bearerToken, json, requestAuthService } from "../../../server/request-auth";

export const Route = createFileRoute("/v1/me/profile")({
  server: {
    handlers: {
      PATCH: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const token = bearerToken(request);
            if (!token) return apiError(401, "unauthorized", "Sign in is required.");
            const body = yield* readJsonObject(request);
            if (!isString(body.name)) {
              return apiError(400, "invalid_profile_name", "Enter a valid display name.");
            }
            return json(yield* requestAuthService().updateName(token, body.name));
          }),
          authErrorResponse,
        ),
    },
  },
});
