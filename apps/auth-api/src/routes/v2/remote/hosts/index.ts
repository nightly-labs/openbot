import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../../server/effect-runtime";
import {
  apiError,
  json,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
  requestUser,
} from "../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/hosts/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const user = await runApiEffect(requestUser(request));
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          return json({ hosts: await runApiEffect(requestRemoteControlPlane().listHosts(user.id)) });
        } catch (error) {
          return remoteControlPlaneErrorResponse(error);
        }
      },
    },
  },
});
