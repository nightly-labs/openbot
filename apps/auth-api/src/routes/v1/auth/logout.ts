import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { sha256 } from "../../../server/crypto";
import { runApiResponse } from "../../../server/effect-runtime";
import {
  apiError,
  authErrorResponse,
  bearerToken,
  requestAuthService,
  requestRemoteControlPlane,
} from "../../../server/request-auth";

export const Route = createFileRoute("/v1/auth/logout")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const token = bearerToken(request);
            if (!token) return apiError(401, "unauthorized", "Sign in is required.");
            const service = requestAuthService();
            const user = yield* service.authenticateDesktopSession(token);
            if (!user) {
              return apiError(401, "unauthorized", "The session is invalid.");
            }
            yield* requestRemoteControlPlane().endAccountSession(user.id, yield* sha256(token));
            return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
          }),
          authErrorResponse,
        ),
    },
  },
});
