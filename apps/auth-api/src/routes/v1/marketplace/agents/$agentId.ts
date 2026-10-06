import { isBoolean } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
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
      PATCH: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            yield* enforceMarketplaceMutationRateLimit("upload", user.id);
            const body = yield* readJsonObject(request);
            if (!isBoolean(body.showCreatorAvatar))
              return apiError(400, "invalid_consent", "Choose whether to show your creator photo.");
            yield* requestAgentMarketplace().setCreatorAvatar(user.id, params.agentId, body.showCreatorAvatar);
            return json({ updated: true });
          }),
          marketplaceErrorResponse,
        ),
      GET: ({ params }) =>
        runApiResponse(
          Effect.gen(function* () {
            return publicMarketplaceJson(yield* requestAgentMarketplace().get(params.agentId));
          }),
          marketplaceErrorResponse,
        ),
    },
  },
});
