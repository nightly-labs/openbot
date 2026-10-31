import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../../server/effect-runtime";
import { readJsonObject } from "../../../../../../server/json-body";
import {
  apiError,
  enforceMarketplaceMutationRateLimit,
  json,
  marketplaceErrorResponse,
  requestAgentMarketplace,
  requireSkillsAdmin,
} from "../../../../../../server/request-auth";

export const Route = createFileRoute("/v1/marketplace/agents/admin/verified/$agentId")({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            if (!(yield* requireSkillsAdmin(request)))
              return apiError(401, "unauthorized", "Admin access is required.");
            yield* enforceMarketplaceMutationRateLimit("mutation", "marketplace-admin");
            const value = yield* readJsonObject(request);
            if (!isDynamicRecord(value) || !isBoolean(value.verified))
              return apiError(400, "invalid_verified", "A verified state is required.");
            yield* requestAgentMarketplace().setVerified(params.agentId, value.verified);
            return json({ updated: true });
          }),
          marketplaceErrorResponse,
        ),
    },
  },
});
