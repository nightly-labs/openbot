import { isBoolean } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { readJsonObject } from "../../../server/json-body";
import {
  apiError,
  enforceMarketplaceMutationRateLimit,
  json,
  publicMarketplaceJson,
  requestSkillMarketplace,
  requestUser,
  skillErrorResponse,
} from "../../../server/request-auth";

export const Route = createFileRoute("/v1/skills/$skillId")({
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
            yield* requestSkillMarketplace().setCreatorAvatar(user.id, params.skillId, body.showCreatorAvatar);
            return json({ updated: true });
          }),
          skillErrorResponse,
        ),
      GET: ({ params }) =>
        runApiResponse(
          Effect.gen(function* () {
            return publicMarketplaceJson(yield* requestSkillMarketplace().get(params.skillId));
          }),
          skillErrorResponse,
        ),
    },
  },
});
