import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../server/effect-runtime";
import {
  apiError,
  hostedServerErrorResponse,
  json,
  requestHostedServerService,
  requestUser,
} from "../../../server/request-auth";

export const Route = createFileRoute("/v2/hosting/plans")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const user = await runApiEffect(requestUser(request));
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          return json(await runApiEffect(requestHostedServerService(request).plans(user)));
        } catch (error) {
          return hostedServerErrorResponse(error);
        }
      },
    },
  },
});
