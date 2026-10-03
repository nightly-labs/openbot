import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../../../server/effect-runtime";
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
      POST: async ({ request, params }) => {
        try {
          requireSitePublishingEnabled();
          const user = await runApiEffect(requestUser(request));
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          return json(
            await runApiEffect(
              requestHostedSiteService().activate(user.id, params.uploadId, requireIdempotencyKey(request)),
            ),
          );
        } catch (error) {
          return hostedSiteErrorResponse(error);
        }
      },
    },
  },
});
