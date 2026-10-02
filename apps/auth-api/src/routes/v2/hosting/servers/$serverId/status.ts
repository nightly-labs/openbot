import { createFileRoute } from "@tanstack/solid-router";
import {
  apiError,
  hostedServerErrorResponse,
  json,
  requestHostedServerService,
  requestUser,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/hosting/servers/$serverId/status")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const user = await requestUser(request);
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          return json(await requestHostedServerService().status(user, params.serverId));
        } catch (error) {
          return hostedServerErrorResponse(error);
        }
      },
    },
  },
});
