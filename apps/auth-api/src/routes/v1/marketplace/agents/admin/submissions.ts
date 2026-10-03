import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../../../server/effect-runtime";
import {
  apiError,
  json,
  marketplaceErrorResponse,
  requestAgentMarketplace,
  requireSkillsAdmin,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v1/marketplace/agents/admin/submissions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!requireSkillsAdmin(request)) return apiError(401, "unauthorized", "Admin access is required.");
        try {
          return json(await runApiEffect(requestAgentMarketplace().listPending()));
        } catch (error) {
          return marketplaceErrorResponse(error);
        }
      },
    },
  },
});
