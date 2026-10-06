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
  requestSourceIp,
} from "../../../server/request-auth";

export const Route = createFileRoute("/v1/mobile-auth/ticket")({
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
            return json(yield* service.issueMobileAuthTicket(token, requestSourceIp(request), body.host));
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
