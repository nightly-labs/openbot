import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../server/effect-runtime";
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
      DELETE: async ({ request, params }) => {
        try {
          const user = await runApiEffect(requestUser(request));
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          const scope = await runApiEffect(requestHostedSiteScope(request, user.id));
          await runApiEffect(requestHostedSiteService().delete(scope, params.siteId, requireIdempotencyKey(request)));
          return json({ deleted: true });
        } catch (error) {
          return hostedSiteErrorResponse(error);
        }
      },
    },
  },
});
