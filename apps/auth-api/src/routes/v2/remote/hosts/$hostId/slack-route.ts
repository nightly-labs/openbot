import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../../../server/effect-runtime";
import { readJsonObject } from "../../../../../server/json-body";
import {
  apiError,
  json,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
} from "../../../../../server/request-auth";

// The Slack route ticket for the host's Signal `ingress` socket. The host proves its machine token,
// as it does for a Signal ticket.
export const Route = createFileRoute("/v2/remote/hosts/$hostId/slack-route")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const body = await readJsonObject(request);
          if (!isString(body.machineToken))
            return apiError(400, "invalid_remote_request", "The host credential is invalid.");
          return json(
            await runApiEffect(requestRemoteControlPlane().issueSlackRoute(params.hostId, body.machineToken)),
          );
        } catch (error) {
          return remoteControlPlaneErrorResponse(error);
        }
      },
    },
  },
});
