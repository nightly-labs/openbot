import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { readJsonObject } from "../../../../server/json-body";
import {
  apiError,
  json,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
} from "../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/invites/preview")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            if (!isString(body.token))
              return apiError(400, "invalid_remote_request", "The invitation token is invalid.");
            return json(yield* requestRemoteControlPlane().previewInvite(body.token));
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
