import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import {
  marketplaceErrorResponse,
  publicMarketplaceJson,
  requestAgentMarketplace,
} from "../../../../../server/request-auth";

export const Route = createFileRoute("/v1/marketplace/agents/$agentId/listing")({
  server: {
    handlers: {
      GET: ({ params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const listing = yield* requestAgentMarketplace().getListing(params.agentId);
            const response = publicMarketplaceJson(listing);
            if (listing.pending) response.headers.set("Cache-Control", "private, no-store");
            return response;
          }),
          marketplaceErrorResponse,
        ),
    },
  },
});
