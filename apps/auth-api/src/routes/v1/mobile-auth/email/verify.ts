import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { readJsonObject } from "../../../../server/json-body";
import { apiError, authErrorResponse, json, requestAuthService } from "../../../../server/request-auth";
import { requestSourceIp } from "../../../../server/source-ip";

// The phone requests the code through `/v1/auth/email/start`. Only this step makes the session a
// mobile session; `/v1/auth/email/verify` makes a desktop session.
export const Route = createFileRoute("/v1/mobile-auth/email/verify")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            if (!isString(body.challengeId) || !isString(body.code)) {
              return apiError(400, "invalid_sign_in_code", "The sign-in code is invalid.");
            }
            if (
              !isString(body.deviceId) ||
              !isString(body.deviceName) ||
              (body.platform !== "ios" && body.platform !== "android" && body.platform !== "unknown")
            ) {
              return apiError(400, "invalid_mobile_device", "The mobile device is invalid.");
            }
            return json(
              yield* requestAuthService().verifyMobileEmailCode({
                challengeId: body.challengeId,
                code: body.code,
                sourceIp: requestSourceIp(request),
                device: { id: body.deviceId, name: body.deviceName, platform: body.platform },
              }),
            );
          }),
          (error) => {
            if (error instanceof SyntaxError) {
              return apiError(400, "invalid_json", "The request body is invalid.");
            }
            return authErrorResponse(error);
          },
        ),
    },
  },
});
