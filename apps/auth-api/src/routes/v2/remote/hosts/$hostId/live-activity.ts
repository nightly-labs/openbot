import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { readJsonObject } from "../../../../../server/json-body";
import { readLiveActivityRelayPush } from "../../../../../server/live-activity-relay";
import {
  apiError,
  remoteControlPlaneErrorResponse,
  requestLiveActivityRelay,
  requestRemoteControlPlane,
} from "../../../../../server/request-auth";

/**
 * A host sends one sealed Live Activity update for a member's phone. The body has the host
 * credential, the push token, and sealed bytes. Nothing of it is stored or logged.
 */
export const Route = createFileRoute("/v2/remote/hosts/$hostId/live-activity")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const body = await readJsonObject(request);
          if (!isString(body.machineToken))
            return apiError(400, "invalid_remote_request", "The host credential is invalid.");
          const push = readLiveActivityRelayPush(body);
          if (!push) return apiError(400, "invalid_live_activity", "The Live Activity update is invalid.");
          await requestRemoteControlPlane().authenticateHost(params.hostId, body.machineToken);
          const relay = requestLiveActivityRelay();
          if (!relay) return apiError(503, "live_activity_unavailable", "Live Activity updates are not available.");
          if (!(await relay.allow(params.hostId))) {
            return apiError(429, "rate_limited", "Too many Live Activity updates.");
          }
          switch (await relay.sender.send(push)) {
            case "sent":
              return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
            case "gone":
              return apiError(410, "live_activity_gone", "The Live Activity no longer receives updates.");
            case "rejected":
              return apiError(400, "live_activity_rejected", "Apple refused the Live Activity update.");
            case "unavailable":
              return apiError(503, "live_activity_unavailable", "Apple did not accept the update now.");
          }
        } catch (error) {
          return remoteControlPlaneErrorResponse(error);
        }
      },
    },
  },
});
