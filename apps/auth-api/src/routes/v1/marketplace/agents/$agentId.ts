import { isBoolean } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { readJsonObject } from "../../../../server/json-body";
import {
  apiError,
  enforceMarketplaceMutationRateLimit,
  json,
  marketplaceErrorResponse,
  publicMarketplaceJson,
  requestAgentMarketplace,
  requestUser,
} from "../../../../server/request-auth";

export const Route = createFileRoute("/v1/marketplace/agents/$agentId")({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        try {
          const user = await requestUser(request);
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          await enforceMarketplaceMutationRateLimit("upload", user.id);
          const body = await readJsonObject(request);
          if (!isBoolean(body.showCreatorAvatar))
            return apiError(400, "invalid_consent", "Choose whether to show your creator photo.");
          await requestAgentMarketplace().setCreatorAvatar(user.id, params.agentId, body.showCreatorAvatar);
          return json({ updated: true });
        } catch (error) {
          return marketplaceErrorResponse(error);
        }
      },
      GET: async ({ params }) => {
        try {
          return publicMarketplaceJson(await requestAgentMarketplace().get(params.agentId));
        } catch (error) {
          return marketplaceErrorResponse(error);
        }
      },
    },
  },
});
