import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../../../server/effect-runtime";
import { readJsonObject } from "../../../../../server/json-body";
import {
  apiError,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
} from "../../../../../server/request-auth";

// Unlinks a Slack workspace from the host that proves its machine token.
export const Route = createFileRoute("/v2/remote/hosts/$hostId/slack-disconnect")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const body = await readJsonObject(request);
          if (!isString(body.machineToken) || !isString(body.teamId))
            return apiError(400, "invalid_remote_request", "The host credential is invalid.");
          await runApiEffect(
            requestRemoteControlPlane().disconnectSlackWorkspace(params.hostId, body.machineToken, body.teamId),
          );
          return new Response(null, { status: 204 });
        } catch (error) {
          return remoteControlPlaneErrorResponse(error);
        }
      },
    },
  },
});
