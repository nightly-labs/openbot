import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import {
  apiError,
  remoteControlPlaneErrorResponse,
  requestUser,
  requestWatchSessions,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/watch/sessions/$watchSessionId")({
  server: {
    handlers: {
      DELETE: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            yield* requestWatchSessions().revoke(user.id, params.watchSessionId);
            return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
