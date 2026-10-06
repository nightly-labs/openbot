import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { apiError, authErrorResponse, bearerToken, requestAuthService } from "../../../../server/request-auth";

export const Route = createFileRoute("/v1/mobile-auth/devices/$sessionId")({
  server: {
    handlers: {
      DELETE: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const token = bearerToken(request);
            if (!token) return apiError(401, "unauthorized", "Sign in is required.");
            if (new URL(request.url).searchParams.get("includeDesktop") === "true") {
              yield* requestAuthService().revokeAccountSession(token, params.sessionId);
            } else yield* requestAuthService().revokeMobileAuthDevice(token, params.sessionId);
            return new Response(null, { status: 204 });
          }),
          authErrorResponse,
        ),
    },
  },
});
