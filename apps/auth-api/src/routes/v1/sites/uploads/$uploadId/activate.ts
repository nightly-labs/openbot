import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { requireIdempotencyKey } from "../../../../../server/hosted-site-contract";
import {
  apiError,
  hostedSiteErrorResponse,
  json,
  requestHostedSiteService,
  requestUser,
  requireSitePublishingEnabled,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v1/sites/uploads/$uploadId/activate")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            requireSitePublishingEnabled();
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            return json(
              yield* requestHostedSiteService().activate(user.id, params.uploadId, requireIdempotencyKey(request)),
            );
          }),
          hostedSiteErrorResponse,
        ),
    },
  },
});
