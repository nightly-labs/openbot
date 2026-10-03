import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../server/effect-runtime";
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
      GET: async ({ request }) => {
        try {
          const user = await runApiEffect(requestUser(request));
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          const scope = await runApiEffect(requestHostedSiteScope(request, user.id));
          return json(await runApiEffect(requestHostedSiteService().list(scope)));
        } catch (error) {
          return hostedSiteErrorResponse(error);
        }
      },
      POST: async ({ request }) => {
        try {
          requireSitePublishingEnabled();
          const user = await runApiEffect(requestUser(request));
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          const scope = await runApiEffect(requestHostedSiteScope(request, user.id));
          const input = parseHostedSiteUploadRequest(await readJsonObject(request));
          return json(
            await runApiEffect(requestHostedSiteService().createUpload(scope, input, requireIdempotencyKey(request))),
            201,
          );
        } catch (error) {
          return hostedSiteErrorResponse(error);
        }
      },
    },
  },
});
