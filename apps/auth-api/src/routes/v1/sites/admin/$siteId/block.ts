import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import {
  apiError,
  hostedSiteErrorResponse,
  json,
  requestHostedSiteService,
  requireOperationsAdmin,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v1/sites/admin/$siteId/block")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            if (!(yield* requireOperationsAdmin(request)))
              return apiError(401, "unauthorized", "Admin access is required.");
            yield* requestHostedSiteService().setBlocked(params.siteId, true);
            return json({ blocked: true });
          }),
          hostedSiteErrorResponse,
        ),
      DELETE: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            if (!(yield* requireOperationsAdmin(request)))
              return apiError(401, "unauthorized", "Admin access is required.");
            yield* requestHostedSiteService().setBlocked(params.siteId, false);
            return json({ blocked: false });
          }),
          hostedSiteErrorResponse,
        ),
    },
  },
});
