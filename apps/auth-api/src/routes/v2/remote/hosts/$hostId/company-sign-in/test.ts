import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../../server/effect-runtime";
import { readJsonObject } from "../../../../../../server/json-body";
import {
  apiError,
  companySignInErrorResponse,
  json,
  requestCompanySignIn,
  requestUser,
} from "../../../../../../server/request-auth";

// Starts a test sign-in with the values of the setup dialog. The connection is saved only when the
// owner signs in at the provider and the callback checks the answer.
export const Route = createFileRoute("/v2/remote/hosts/$hostId/company-sign-in/test")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const body = yield* readJsonObject(request);
            const { issuer, clientId, clientSecret, domains, returnTo, clientState } = body;
            if (
              !isString(issuer) ||
              !isString(clientId) ||
              !isString(clientSecret) ||
              !Array.isArray(domains) ||
              !domains.every(isString) ||
              !isString(returnTo) ||
              !isString(clientState)
            ) {
              return apiError(400, "invalid_company_sign_in", "The request is invalid.");
            }
            return json(
              yield* requestCompanySignIn().startTest(
                user,
                params.hostId,
                { issuer, clientId, clientSecret, domains, returnTo, clientState },
                request.url,
              ),
            );
          }),
          companySignInErrorResponse,
        ),
    },
  },
});
