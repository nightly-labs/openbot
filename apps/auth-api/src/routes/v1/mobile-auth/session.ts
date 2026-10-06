import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { apiError, authErrorResponse, bearerToken, json, requestAuthService } from "../../../server/request-auth";

export const Route = createFileRoute("/v1/mobile-auth/session")({
  server: {
    handlers: {
      GET: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const token = bearerToken(request);
            if (!token) return apiError(401, "unauthorized", "Sign in is required.");
            const user = yield* requestAuthService().authenticateMobileSession(token);
            return user ? json(user) : apiError(401, "unauthorized", "The mobile session is invalid.");
          }),
          authErrorResponse,
        ),
      DELETE: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const token = bearerToken(request);
            if (!token) return apiError(401, "unauthorized", "Sign in is required.");
            yield* requestAuthService().logoutMobileSession(token);
            return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
          }),
          authErrorResponse,
        ),
    },
  },
});
