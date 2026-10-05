import { createFileRoute } from "@tanstack/solid-router";
import { readJsonObject } from "../../server/json-body";
import {
  accountDeletionErrorResponse,
  apiError,
  authErrorResponse,
  bearerToken,
  json,
  requestAccountDeletion,
  requestAuthService,
} from "../../server/request-auth";

export const Route = createFileRoute("/v1/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const token = bearerToken(request);
          if (!token) return apiError(401, "unauthorized", "Sign in is required.");
          const user = await requestAuthService().authenticate(token);
          return user ? json(user) : apiError(401, "unauthorized", "The session is invalid.");
        } catch (error) {
          return authErrorResponse(error);
        }
      },
      DELETE: async ({ request }) => {
        try {
          const token = bearerToken(request);
          if (!token) return apiError(401, "unauthorized", "Sign in is required.");
          const user = await requestAuthService().authenticate(token);
          if (!user) return apiError(401, "unauthorized", "The session is invalid.");
          const body = await readJsonObject(request);
          await requestAccountDeletion(user, body.email);
          return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          return accountDeletionErrorResponse(error);
        }
      },
    },
  },
});
