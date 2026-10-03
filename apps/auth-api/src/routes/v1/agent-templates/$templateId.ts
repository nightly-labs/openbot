import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../server/effect-runtime";
import {
  apiError,
  enforceMarketplaceMutationRateLimit,
  json,
  marketplaceErrorResponse,
  requestAgentTemplates,
  requestUser,
} from "../../../server/request-auth";

export const Route = createFileRoute("/v1/agent-templates/$templateId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          // Not cached: after an unpublish no copy may still show the instructions.
          return json(await runApiEffect(requestAgentTemplates().get(params.templateId)));
        } catch (error) {
          return marketplaceErrorResponse(error);
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          const user = await runApiEffect(requestUser(request));
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          await runApiEffect(enforceMarketplaceMutationRateLimit("mutation", user.id));
          await runApiEffect(requestAgentTemplates().unpublish(user.id, params.templateId));
          return json({ deleted: true });
        } catch (error) {
          return marketplaceErrorResponse(error);
        }
      },
    },
  },
});
