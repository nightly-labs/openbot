import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { parseHostedSiteUploadRequest, requireIdempotencyKey } from "../../../server/hosted-site-contract";
import { readJsonObject } from "../../../server/json-body";
import {
  apiError,
  hostedSiteErrorResponse,
  json,
  requestHostedSiteScope,
  requestHostedSiteService,
  requestUser,
  requireSitePublishingEnabled,
} from "../../../server/request-auth";

export const Route = createFileRoute("/v1/sites/")({
  server: {
    handlers: {
      GET: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const scope = yield* requestHostedSiteScope(request, user.id);
            return json(yield* requestHostedSiteService().list(scope));
          }),
          hostedSiteErrorResponse,
        ),
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            requireSitePublishingEnabled();
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const scope = yield* requestHostedSiteScope(request, user.id);
            const input = parseHostedSiteUploadRequest(yield* readJsonObject(request));
            return json(
              yield* requestHostedSiteService().createUpload(scope, input, requireIdempotencyKey(request)),
              201,
            );
          }),
          hostedSiteErrorResponse,
        ),
    },
  },
});
