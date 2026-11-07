import { isBoolean } from "@openbot/contracts/runtime-values";
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

// The company sign-in of a server. Only its owner reads or changes it.
export const Route = createFileRoute("/v2/remote/hosts/$hostId/company-sign-in/")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            return json(yield* requestCompanySignIn().settings(user, params.hostId, request.url));
          }),
          companySignInErrorResponse,
        ),
      PUT: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const body = yield* readJsonObject(request);
            if (!isBoolean(body.enabled)) return apiError(400, "invalid_company_sign_in", "The request is invalid.");
            yield* requestCompanySignIn().setEnabled(user, params.hostId, body.enabled);
            return new Response(null, { status: 204 });
          }),
          companySignInErrorResponse,
        ),
      DELETE: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            yield* requestCompanySignIn().remove(user, params.hostId);
            return new Response(null, { status: 204 });
          }),
          companySignInErrorResponse,
        ),
    },
  },
});
