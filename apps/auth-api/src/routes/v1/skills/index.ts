import { isSkillCategory, type MarketplaceSkillSort } from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { readMultipartFormData } from "../../../server/json-body";
import { normalizeMarketplaceQuery, parseMarketplaceLimit } from "../../../server/marketplace-pagination";
import {
  apiError,
  enforceMarketplaceMutationRateLimit,
  json,
  publicMarketplaceJson,
  requestSkillMarketplace,
  requestUser,
  skillErrorResponse,
} from "../../../server/request-auth";

const SKILL_SUBMISSION_BODY_LIMIT = 12 * 1024 * 1024;

export const Route = createFileRoute("/v1/skills/")({
  server: {
    handlers: {
      GET: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const url = new URL(request.url);
            const category = url.searchParams.get("category") ?? undefined;
            const sortParam = url.searchParams.get("sort") ?? undefined;
            const verifiedParam = url.searchParams.get("verified");
            if (category && !isSkillCategory(category))
              return apiError(400, "invalid_category", "Unknown skill category.");
            const sort = sortParam ? skillSort(sortParam) : undefined;
            if (sort === null) return apiError(400, "invalid_sort", "Unknown skill sort order.");
            if (verifiedParam !== null && verifiedParam !== "true" && verifiedParam !== "false")
              return apiError(400, "invalid_verified", "The verified filter must be true or false.");
            return publicMarketplaceJson(
              yield* requestSkillMarketplace().list({
                query: normalizeMarketplaceQuery(url.searchParams.get("query") ?? undefined),
                category,
                featured: url.searchParams.get("featured") === "true",
                verified: verifiedParam === null ? undefined : verifiedParam === "true",
                sort,
                cursor: url.searchParams.get("cursor") ?? undefined,
                limit: parseMarketplaceLimit(url.searchParams.get("limit")),
              }),
            );
          }),
          skillErrorResponse,
        ),
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            yield* enforceMarketplaceMutationRateLimit("upload", user.id);
            const form = yield* readMultipartFormData(request, SKILL_SUBMISSION_BODY_LIMIT);
            const showCreatorAvatar = form.get("showCreatorAvatar");
            if (showCreatorAvatar !== null && showCreatorAvatar !== "true" && showCreatorAvatar !== "false")
              return apiError(400, "invalid_consent", "Choose whether to show your creator photo.");
            const bundle = form.get("bundle");
            const icon = form.get("icon");
            const category = form.get("category");
            const skillId = form.get("skillId");
            if (!(bundle instanceof File) || !isString(category) || !isSkillCategory(category)) {
              return apiError(400, "invalid_submission", "A skill bundle and category are required.");
            }
            if (icon !== null && !(icon instanceof File)) return apiError(400, "invalid_icon", "The icon is invalid.");
            return json(
              yield* requestSkillMarketplace().submit({
                user,
                ...(showCreatorAvatar !== null ? { showCreatorAvatar: showCreatorAvatar === "true" } : {}),
                archive: new Uint8Array(yield* Effect.promise(() => bundle.arrayBuffer())),
                category,
                icon:
                  icon instanceof File
                    ? { bytes: new Uint8Array(yield* Effect.promise(() => icon.arrayBuffer())), mimeType: icon.type }
                    : null,
                ...(isString(skillId) && skillId ? { skillId } : {}),
              }),
              201,
            );
          }),
          skillErrorResponse,
        ),
    },
  },
});

function skillSort(value: string): MarketplaceSkillSort | null {
  return value === "installs" || value === "updated" || value === "name" ? value : null;
}
