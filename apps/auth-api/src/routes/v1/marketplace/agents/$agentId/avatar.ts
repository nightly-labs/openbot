import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { marketplaceErrorResponse, requestAgentMarketplace } from "../../../../../server/request-auth";

export const Route = createFileRoute("/v1/marketplace/agents/$agentId/avatar")({
  server: {
    handlers: {
      GET: ({ params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const object = yield* requestAgentMarketplace().avatar(params.agentId);
            const headers = new Headers();
            object.writeHttpMetadata(headers);
            headers.set("Cache-Control", "public, max-age=300");
            headers.set("ETag", object.httpEtag);
            headers.set("X-Content-Type-Options", "nosniff");
            return new Response(object.body, { headers });
          }),
          marketplaceErrorResponse,
        ),
    },
  },
});
