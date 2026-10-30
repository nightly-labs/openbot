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

export const Route = createFileRoute("/v1/skills/admin/verified/$skillId")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            if (!(yield* requireSkillsAdmin(request)))
              return apiError(401, "unauthorized", "An admin token is required.");
            yield* enforceMarketplaceMutationRateLimit("mutation", "marketplace-admin");
            const value = yield* readJsonObject(request);
            if (!isDynamicRecord(value) || !isBoolean(value.verified)) {
              return apiError(400, "invalid_verified_state", "A verified boolean is required.");
            }
            yield* requestSkillMarketplace().setVerified(params.skillId, value.verified);
            return json({ updated: true });
          }),
          skillErrorResponse,
        ),
    },
  },
});
