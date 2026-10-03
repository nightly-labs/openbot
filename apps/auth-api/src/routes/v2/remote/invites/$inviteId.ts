import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../../server/effect-runtime";
import {
  apiError,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
  requestUser,
} from "../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/invites/$inviteId")({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        try {
          const user = await runApiEffect(requestUser(request));
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          await runApiEffect(requestRemoteControlPlane().revokeInvite(user.id, params.inviteId));
          return new Response(null, { status: 204 });
        } catch (error) {
          return remoteControlPlaneErrorResponse(error);
        }
      },
    },
  },
});
