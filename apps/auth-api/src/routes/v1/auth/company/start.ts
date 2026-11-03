import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { readJsonObject } from "../../../../server/json-body";
import { apiError, companySignInErrorResponse, json, requestCompanySignIn } from "../../../../server/request-auth";
import { requestSourceIp } from "../../../../server/source-ip";

// The app asks for the company provider's sign-in page after the email start answers
// `company_sign_in_required`. The app opens the answer in the browser.
export const Route = createFileRoute("/v1/auth/company/start")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            const { email, returnTo, clientState, clientChallenge } = body;
            if (!isString(email) || !isString(returnTo) || !isString(clientState) || !isString(clientChallenge)) {
              return apiError(400, "invalid_company_sign_in", "The sign-in request is invalid.");
            }
            return json(
              yield* requestCompanySignIn().startSignIn(
                { email, returnTo, clientState, clientChallenge, sourceIp: requestSourceIp(request) },
                request.url,
              ),
            );
          }),
          companySignInErrorResponse,
        ),
    },
  },
});
