import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import {
  apiError,
  json,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
  requestUser,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/owner-transfers/$transferId/accept")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            return json(yield* requestRemoteControlPlane().acceptOwnerTransfer(user, params.transferId));
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
