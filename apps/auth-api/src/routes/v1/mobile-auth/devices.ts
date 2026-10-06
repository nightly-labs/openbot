import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { apiError, authErrorResponse, bearerToken, json, requestAuthService } from "../../../server/request-auth";

export const Route = createFileRoute("/v1/mobile-auth/devices")({
  server: {
    handlers: {
      GET: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const token = bearerToken(request);
            if (!token) return apiError(401, "unauthorized", "Sign in is required.");
            // Additive opt-in: existing clients continue receiving only mobile devices.
            if (new URL(request.url).searchParams.get("includeDesktop") === "true") {
              return json({ sessions: yield* requestAuthService().listAccountSessions(token) });
            }
            return json({ devices: yield* requestAuthService().listMobileAuthDevices(token) });
          }),
          authErrorResponse,
        ),
    },
  },
});
