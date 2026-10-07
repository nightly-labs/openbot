import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { readJsonObject } from "../../../../../server/json-body";
import {
  apiError,
  enforceMarketplaceMutationRateLimit,
  json,
  requestSkillMarketplace,
  requireSkillsAdmin,
  skillErrorResponse,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v1/skills/admin/featured/$skillId")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            if (!(yield* requireSkillsAdmin(request)))
              return apiError(401, "unauthorized", "An admin token is required.");
            yield* enforceMarketplaceMutationRateLimit("mutation", "marketplace-admin");
            const value = yield* readJsonObject(request);
            if (!isDynamicRecord(value) || !isBoolean(value.featured)) {
              return apiError(400, "invalid_featured_state", "A featured boolean is required.");
            }
            yield* requestSkillMarketplace().setFeatured(params.skillId, value.featured);
            return json({ updated: true });
          }),
          skillErrorResponse,
        ),
    },
  },
});
