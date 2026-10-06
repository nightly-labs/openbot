import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { requireIdempotencyKey } from "../../../server/hosted-site-contract";
import {
  apiError,
  hostedSiteErrorResponse,
  json,
  requestHostedSiteScope,
  requestHostedSiteService,
  requestUser,
} from "../../../server/request-auth";

export const Route = createFileRoute("/v1/sites/$siteId")({
  server: {
    handlers: {
      DELETE: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const scope = yield* requestHostedSiteScope(request, user.id);
            yield* requestHostedSiteService().delete(scope, params.siteId, requireIdempotencyKey(request));
            return json({ deleted: true });
          }),
          hostedSiteErrorResponse,
        ),
    },
  },
});
