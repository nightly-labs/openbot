import { createFileRoute } from "@tanstack/solid-router";
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
          return json(await requestAgentTemplates().get(params.templateId));
        } catch (error) {
          return marketplaceErrorResponse(error);
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          const user = await requestUser(request);
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          await enforceMarketplaceMutationRateLimit("mutation", user.id);
          await requestAgentTemplates().unpublish(user.id, params.templateId);
          return json({ deleted: true });
        } catch (error) {
          return marketplaceErrorResponse(error);
        }
      },
    },
  },
});
