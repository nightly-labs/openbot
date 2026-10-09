import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import {
  apiError,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
  requestUser,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/hosts/$hostId/")({
  server: {
    handlers: {
      // The owner removes the host from the account service. The host does not need to be online.
      DELETE: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            yield* requestRemoteControlPlane().removeOwnedHost(user.id, params.hostId);
            return new Response(null, { status: 204 });
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
