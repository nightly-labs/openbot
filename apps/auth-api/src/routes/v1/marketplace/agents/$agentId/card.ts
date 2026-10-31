import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { marketplaceCardResponse } from "../../../../../server/marketplace-cards";
import { marketplaceErrorResponse, requestAgentMarketplace } from "../../../../../server/request-auth";

/** The share card a link preview of the agent's page shows. It is public, like the page. */
export const Route = createFileRoute("/v1/marketplace/agents/$agentId/card")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const object = yield* requestAgentMarketplace().card(params.agentId, request.headers);
            return marketplaceCardResponse(object);
          }),
          marketplaceErrorResponse,
        ),
    },
  },
});
