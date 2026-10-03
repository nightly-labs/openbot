import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../server/effect-runtime";
import { apiError, authErrorResponse, bearerToken, json, requestAuthService } from "../../server/request-auth";

export const Route = createFileRoute("/v1/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const token = bearerToken(request);
          if (!token) return apiError(401, "unauthorized", "Sign in is required.");
          const user = await runApiEffect(requestAuthService().authenticate(token));
          return user ? json(user) : apiError(401, "unauthorized", "The session is invalid.");
        } catch (error) {
          return authErrorResponse(error);
        }
      },
    },
  },
});
