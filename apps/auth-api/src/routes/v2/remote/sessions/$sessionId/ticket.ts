import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
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
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const body = yield* readJsonObject(request);
            if (!isString(body.clientPublicKey)) {
              return apiError(400, "invalid_remote_request", "The client public key is required.");
            }
            return json({
              ...(yield* requestRemoteControlPlane().issueSessionTicket(
                user.id,
                params.sessionId,
                body.clientPublicKey,
              )),
              signalUrl: requestRemoteSignalUrl(),
            });
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
