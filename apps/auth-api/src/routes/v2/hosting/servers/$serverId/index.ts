import { createFileRoute } from "@tanstack/solid-router";
import { readJsonObject } from "../../../../../server/json-body";
import {
  apiError,
  hostedServerErrorResponse,
  requestHostedServerService,
  requestUser,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/hosting/servers/$serverId/")({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        try {
          const user = await requestUser(request);
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          const body = await readJsonObject(request);
          await requestHostedServerService().delete(user, params.serverId, body.confirmName);
          return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          return hostedServerErrorResponse(error);
        }
      },
    },
  },
});
