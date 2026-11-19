import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { readJsonObject } from "../../../../../server/json-body";
import {
  apiError,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
  requestUser,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/hosts/$hostId/appearance")({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const body = yield* readJsonObject(request);
            const appearance = yield* requestRemoteControlPlane().setHostAppearance(
              user.id,
              params.hostId,
              body.appearance,
            );
            return Response.json({ appearance }, { headers: { "Cache-Control": "no-store" } });
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
