import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { readJsonObject } from "../../../../server/json-body";
import {
  apiError,
  authErrorResponse,
  json,
  requestAuthService,
  requestSourceIp,
} from "../../../../server/request-auth";

export const Route = createFileRoute("/v1/auth/email/start")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            if (!isString(body.email)) {
              return apiError(400, "invalid_email", "Enter a valid email address.");
            }
            const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
            return json(
              yield* requestAuthService().startEmailSignIn(body.email, requestSourceIp(request), idempotencyKey),
            );
          }),
          (error) => {
            if (error instanceof SyntaxError) {
              return apiError(400, "invalid_json", "The request body is invalid.");
            }
            return authErrorResponse(error);
          },
        ),
    },
  },
});
