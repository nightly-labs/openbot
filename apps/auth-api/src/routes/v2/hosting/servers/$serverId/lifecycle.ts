import { parseHostedServerLifecycleInput } from "@openbot/contracts/hosted-servers";
import { sourceText } from "@openbot/i18n/source";
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

export const Route = createFileRoute("/v2/hosting/servers/$serverId/lifecycle")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const body = yield* readJsonObject(request);
            const input = parseHostedServerLifecycleInput({ ...body, serverId: params.serverId });
            if (!input) return apiError(400, "invalid_request", sourceText("error.billing.invalidRequest"));
            yield* requestHostedServerService().lifecycle(user, params.serverId, input);
            return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
          }),
          hostedServerErrorResponse,
        ),
    },
  },
});
