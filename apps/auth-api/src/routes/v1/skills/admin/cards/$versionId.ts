import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { readMarketplaceCard } from "../../../../../server/marketplace-cards";
import {
  apiError,
  enforceMarketplaceMutationRateLimit,
  json,
  requestSkillMarketplace,
  requireSkillsAdmin,
  skillErrorResponse,
} from "../../../../../server/request-auth";

/** The reviewer's script stores the share card it drew for an approved version. The body is the PNG. */
export const Route = createFileRoute("/v1/skills/admin/cards/$versionId")({
  server: {
    handlers: {
      PUT: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            if (!(yield* requireSkillsAdmin(request)))
              return apiError(401, "unauthorized", "An admin token is required.");
            yield* enforceMarketplaceMutationRateLimit("upload", "marketplace-admin");
            const card = yield* readMarketplaceCard(request);
            if (!card) return apiError(400, "invalid_card", "The share card must be a 1200 × 630 PNG.");
            yield* requestSkillMarketplace().setCard(params.versionId, card);
            return json({ updated: true });
          }),
          skillErrorResponse,
        ),
    },
  },
});
