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

// The host proves its machine token, as it does for a Signal ticket. The returned ticket names
// only route IDs that this host registered in D1.
export const Route = createFileRoute("/v2/remote/hosts/$hostId/webhook-route")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            if (!isString(body.machineToken))
              return apiError(400, "invalid_remote_request", "The host credential is invalid.");
            return json(yield* requestRemoteControlPlane().issueWebhookRoute(params.hostId, body.machineToken));
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
