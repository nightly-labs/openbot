import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../server/effect-runtime";
import { apiError, authErrorResponse, bearerToken, json, requestAuthService } from "../../../server/request-auth";

export const Route = createFileRoute("/v1/mobile-auth/devices")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const token = bearerToken(request);
          if (!token) return apiError(401, "unauthorized", "Sign in is required.");
          // Additive opt-in: existing clients continue receiving only mobile devices.
          if (new URL(request.url).searchParams.get("includeDesktop") === "true") {
            return json({ sessions: await runApiEffect(requestAuthService().listAccountSessions(token)) });
          }
          return json({ devices: await runApiEffect(requestAuthService().listMobileAuthDevices(token)) });
        } catch (error) {
          return authErrorResponse(error);
        }
      },
    },
  },
});
