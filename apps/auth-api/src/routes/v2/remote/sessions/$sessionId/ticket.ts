import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../../../server/effect-runtime";
import { readJsonObject } from "../../../../../server/json-body";
import {
  apiError,
  json,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
  requestRemoteSignalUrl,
  requestUser,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/sessions/$sessionId/ticket")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const user = await runApiEffect(requestUser(request));
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          const body = await readJsonObject(request);
          if (!isString(body.clientPublicKey)) {
            return apiError(400, "invalid_remote_request", "The client public key is required.");
          }
          return json({
            ...(await runApiEffect(
              requestRemoteControlPlane().issueSessionTicket(user.id, params.sessionId, body.clientPublicKey),
            )),
            signalUrl: requestRemoteSignalUrl(),
          });
        } catch (error) {
          return remoteControlPlaneErrorResponse(error);
        }
      },
    },
  },
});
