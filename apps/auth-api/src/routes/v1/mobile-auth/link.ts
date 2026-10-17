import { isMobileConnectHostBinding } from "@openbot/contracts/mobile-connect";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { readJsonObject } from "../../../server/json-body";
import {
  apiError,
  bearerToken,
  json,
  remoteControlPlaneErrorResponse,
  requestAuthService,
  requestRemoteControlPlane,
} from "../../../server/request-auth";
import { requestSourceIp } from "../../../server/source-ip";

export const Route = createFileRoute("/v1/mobile-auth/link")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const token = bearerToken(request);
            if (!token) return apiError(401, "unauthorized", "Sign in is required.");
            const service = requestAuthService();
            const user = yield* service.authenticateDesktopSession(token);
            if (!user) return apiError(401, "unauthorized", "A desktop session is required.");
            const body = yield* readJsonObject(request);
            if (!isMobileConnectHostBinding(body.host))
              return apiError(
                400,
                "invalid_mobile_host",
                "Update the desktop app to create a host-bound Mobile Connect code.",
              );
            yield* requestRemoteControlPlane().validateMobileConnectHost(user.id, body.host);
            return json(yield* service.createMobileConnectLink(token, requestSourceIp(request), body.host));
          }),
          remoteControlPlaneErrorResponse,
        ),
      DELETE: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const token = bearerToken(request);
            if (!token) return apiError(401, "unauthorized", "Sign in is required.");
            const hostId = new URL(request.url).searchParams.get("host") ?? "";
            yield* requestAuthService().revokeMobileConnectLink(token, hostId);
            return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
