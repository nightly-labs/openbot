import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../server/effect-runtime";
import {
  apiError,
  json,
  marketplaceErrorResponse,
  requestAgentTemplates,
  requestUser,
} from "../../../server/request-auth";

export const Route = createFileRoute("/v1/agent-templates/mine")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const user = await runApiEffect(requestUser(request));
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          return json(await runApiEffect(requestAgentTemplates().listMine(user.id)));
        } catch (error) {
          return marketplaceErrorResponse(error);
        }
      },
    },
  },
});
