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
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/hosts/$hostId/owner-session")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            if (!isString(body.machineToken))
              return apiError(400, "invalid_remote_request", "The host credential is invalid.");
            if (!(body.previousSessionToken === undefined || isString(body.previousSessionToken)))
              return apiError(400, "invalid_remote_request", "The previous session is invalid.");
            return json(
              yield* requestRemoteControlPlane().issueTransferredOwnerSession(
                params.hostId,
                body.machineToken,
                body.previousSessionToken ?? null,
              ),
            );
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
