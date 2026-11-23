import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { normalizeMobileDevice } from "../../../server/auth-service";
import { CompanySignInError } from "../../../server/company-sign-in";
import { runApiResponse } from "../../../server/effect-runtime";
import { readJsonObject } from "../../../server/json-body";
import { apiError, companySignInErrorResponse, json, requestCompanySignIn } from "../../../server/request-auth";

export const Route = createFileRoute("/v1/browser-extension/exchange")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            if (!isString(body.code) || !isString(body.codeVerifier)) {
              return apiError(400, "invalid_company_sign_in_code", "The sign-in did not finish. Try again.");
            }
            const { deviceId, deviceName } = body;
            if (!isString(deviceId) || !isString(deviceName)) {
              return apiError(400, "invalid_mobile_device", "The mobile device is invalid.");
            }
            const device = yield* Effect.try({
              try: () => normalizeMobileDevice({ id: deviceId, name: deviceName, platform: "unknown" }),
              catch: () => new CompanySignInError(400, "invalid_mobile_device", "The mobile device is invalid."),
            });
            return json(
              yield* requestCompanySignIn().exchange({ code: body.code, codeVerifier: body.codeVerifier, device }),
            );
          }),
          companySignInErrorResponse,
        ),
    },
  },
});
