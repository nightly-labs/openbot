import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { readJsonObject } from "../../../../server/json-body";
import { hostedServerErrorResponse, json, requestHostedServerService } from "../../../../server/request-auth";

/**
 * A free prepared machine of the operator's pool asks for its server. It has no per-address limit: a
 * machine asks each 10 seconds, and a wrong token costs one read by primary key.
 */
export const Route = createFileRoute("/v2/hosting/pool/assignment")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            return json(yield* requestHostedServerService().poolAssignment(body.hostId, body.token));
          }),
          hostedServerErrorResponse,
        ),
    },
  },
});
