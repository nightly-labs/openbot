import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
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

export const Route = createFileRoute("/v1/skills/admin/submissions/$versionId")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            if (!(yield* requireSkillsAdmin(request)))
              return apiError(401, "unauthorized", "An admin token is required.");
            yield* enforceMarketplaceMutationRateLimit("mutation", "marketplace-admin");
            const value = yield* readJsonObject(request);
            if (
              !isDynamicRecord(value) ||
              (value.action !== "approve" && value.action !== "reject") ||
              (value.note !== undefined && !isString(value.note))
            ) {
              return apiError(400, "invalid_review", "A valid review action is required.");
            }
            const note = value.note;
            yield* requestSkillMarketplace().review(params.versionId, value.action, note);
            return json({ reviewed: true });
          }),
          skillErrorResponse,
        ),
    },
  },
});
