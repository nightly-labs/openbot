import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { marketplaceErrorResponse, requestAgentTemplates } from "../../../../server/request-auth";

export const Route = createFileRoute("/v1/agent-templates/$templateId/card")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const object = yield* requestAgentTemplates().card(params.templateId, request.headers);
            const headers = new Headers();
            object.writeHttpMetadata(headers);
            headers.set("Content-Type", "image/png");
            headers.set("Cache-Control", "public, no-cache");
            headers.set("ETag", object.httpEtag);
            headers.set("X-Content-Type-Options", "nosniff");
            if (!("body" in object)) return new Response(null, { status: 304, headers });
            return new Response(object.body, { headers });
          }),
          marketplaceErrorResponse,
        ),
    },
  },
});
