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
} from "../../../../../server/request-auth";

// Webhook routine creation and deletion on the host change only account routing metadata. The HMAC secret and
// event data remain on the host.
export const Route = createFileRoute("/v2/remote/hosts/$hostId/webhook-routes")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            if (!isString(body.machineToken) || !isString(body.routeId))
              return apiError(400, "invalid_remote_request", "The webhook route is invalid.");
            return json(
              yield* requestRemoteControlPlane().registerWebhookRoute(params.hostId, body.machineToken, body.routeId),
              201,
            );
          }),
          remoteControlPlaneErrorResponse,
        ),
      DELETE: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            if (!isString(body.machineToken) || !isString(body.routeId))
              return apiError(400, "invalid_remote_request", "The webhook route is invalid.");
            yield* requestRemoteControlPlane().disconnectWebhookRoute(params.hostId, body.machineToken, body.routeId);
            return new Response(null, { status: 204 });
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
