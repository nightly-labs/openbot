import { createFileRoute } from "@tanstack/solid-router";
import {
  apiError,
  hostedServerErrorResponse,
  json,
  requestHostedServerService,
  requestUser,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/hosting/servers/$serverId/checkout")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const user = await requestUser(request);
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          return json(
            await requestHostedServerService(request).checkout(user, params.serverId, {
              target: "desktop",
              origin: new URL(request.url).origin,
            }),
          );
        } catch (error) {
          return hostedServerErrorResponse(error);
        }
      },
    },
  },
});
