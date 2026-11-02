import { decodeHostKeyHandover, type HostKeyHandover } from "@openbot/contracts/host-key-handover";
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
  requestUser,
} from "../../../../../server/request-auth";

// The signed-in owner's host moves its identity to a new key. The host proves its machine token, and
// its previous key and new key both sign the step.
export const Route = createFileRoute("/v2/remote/hosts/$hostId/key-handover")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const body = yield* readJsonObject(request);
            const handover = decodedHandover(body.handover);
            if (!isString(body.machineToken) || !handover) {
              return apiError(400, "invalid_remote_request", "The host key handover is invalid.");
            }
            return json(
              yield* requestRemoteControlPlane().handOverHostKey(user, {
                hostId: params.hostId,
                machineToken: body.machineToken,
                handover,
              }),
            );
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});

function decodedHandover(value: unknown): HostKeyHandover | null {
  try {
    return decodeHostKeyHandover(value);
  } catch {
    return null;
  }
}
