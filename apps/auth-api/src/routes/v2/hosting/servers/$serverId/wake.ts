import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import {
  apiError,
  hostedServerErrorResponse,
  json,
  requestHostedServerService,
  requestUser,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/hosting/servers/$serverId/wake")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            return json(yield* requestHostedServerService().wake(user, params.serverId));
          }),
          hostedServerErrorResponse,
        ),
    },
  },
});
