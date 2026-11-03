import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { marketplaceCardResponse } from "../../../../server/marketplace-cards";
import { requestSkillMarketplace, skillErrorResponse } from "../../../../server/request-auth";

/** The share card a link preview of the skill's page shows. It is public, like the page. */
export const Route = createFileRoute("/v1/skills/$skillId/card")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            return marketplaceCardResponse(yield* requestSkillMarketplace().card(params.skillId, request.headers));
          }),
          skillErrorResponse,
        ),
    },
  },
});
