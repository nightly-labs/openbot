import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { readAndroidNotificationRelayPush } from "../../../../../server/android-notification-relay";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { readJsonObject } from "../../../../../server/json-body";
import {
  apiError,
  remoteControlPlaneErrorResponse,
  requestFcmRelay,
  requestRemoteControlPlane,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/hosts/$hostId/android-notification")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            if (!isString(body.machineToken))
              return apiError(400, "invalid_remote_request", "The host credential is invalid.");
            const push = readAndroidNotificationRelayPush(body);
            if (!push) return apiError(400, "invalid_notification", "The notification is invalid.");
            const controlPlane = requestRemoteControlPlane();
            yield* controlPlane.assertHostCredential(params.hostId, body.machineToken);
            const relay = requestFcmRelay();
            if (!relay) return apiError(503, "notification_unavailable", "Notifications are not available.");
            if (!(yield* relay.allowNotification(params.hostId))) {
              return apiError(429, "rate_limited", "Too many notifications.");
            }
            if (!(yield* controlPlane.sessionOpen(params.hostId, push.sessionId))) {
              return apiError(410, "notification_gone", "The phone no longer receives notifications.");
            }
            switch (yield* relay.sender.sendNotification(push)) {
              case "sent":
                return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
              case "gone":
                return apiError(410, "notification_gone", "The phone no longer receives notifications.");
              case "rejected":
                return apiError(400, "notification_rejected", "Firebase refused the notification.");
              case "unavailable":
                return apiError(503, "notification_unavailable", "Firebase did not accept the notification now.");
            }
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
