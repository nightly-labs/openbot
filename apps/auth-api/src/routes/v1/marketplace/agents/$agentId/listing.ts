import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import {
  marketplaceErrorResponse,
  publicMarketplaceJson,
  requestAgentMarketplace,
} from "../../../../../server/request-auth";

/**
 * The agent a shared link names. Unlike `GET /v1/marketplace/agents/:id`, which a released desktop
 * reads as "approved", it also returns an agent that waits for its first review, marked `pending`.
 */
export const Route = createFileRoute("/v1/marketplace/agents/$agentId/listing")({
  server: {
    handlers: {
      GET: ({ params }) =>
        runApiResponse(
          Effect.gen(function* () {
            return publicMarketplaceJson(yield* requestAgentMarketplace().getListing(params.agentId));
          }),
          marketplaceErrorResponse,
        ),
    },
  },
});
