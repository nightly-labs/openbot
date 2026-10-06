import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
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
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            if (!isString(body.machineToken) || !isString(body.teamId))
              return apiError(400, "invalid_remote_request", "The host credential is invalid.");
            yield* requestRemoteControlPlane().disconnectSlackWorkspace(params.hostId, body.machineToken, body.teamId);
            return new Response(null, { status: 204 });
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
