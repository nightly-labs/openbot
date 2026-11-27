import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { readJsonObject } from "../../../../../server/json-body";
import { readWidgetRelayPush } from "../../../../../server/live-activity-relay";
import {
  apiError,
  remoteControlPlaneErrorResponse,
  requestApnsRelay,
  requestRemoteControlPlane,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/hosts/$hostId/widget-push")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            if (!isString(body.machineToken))
              return apiError(400, "invalid_remote_request", "The host credential is invalid.");
            const push = readWidgetRelayPush(body);
            if (!push) return apiError(400, "invalid_widget_push", "The widget push is invalid.");
            yield* requestRemoteControlPlane().assertHostCredential(params.hostId, body.machineToken);
            const relay = requestApnsRelay();
            if (!relay) return apiError(503, "widget_push_unavailable", "Widget pushes are not available.");
            if (!(yield* relay.allowWidgetPush(params.hostId))) {
              return apiError(429, "rate_limited", "Too many widget pushes.");
            }
            switch (yield* relay.sender.sendWidgetPush(push)) {
              case "sent":
                return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
              case "gone":
                return apiError(410, "widget_push_gone", "The widget no longer receives pushes.");
              case "rejected":
                return apiError(400, "widget_push_rejected", "Apple refused the widget push.");
              case "unavailable":
                return apiError(503, "widget_push_unavailable", "Apple did not accept the push now.");
            }
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
