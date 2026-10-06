import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { readJsonObject } from "../../../../../server/json-body";
import {
  apiError,
  hostedServerErrorResponse,
  requestHostedServerService,
  requestUser,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/hosting/servers/$serverId/")({
  server: {
    handlers: {
      DELETE: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const body = yield* readJsonObject(request);
            yield* requestHostedServerService().delete(user, params.serverId, body.confirmName);
            return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
          }),
          hostedServerErrorResponse,
        ),
    },
  },
});
