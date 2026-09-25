import { createFileRoute } from "@tanstack/solid-router";
import { marketplaceErrorResponse, requestAgentTemplates } from "../../../../server/request-auth";

/** The share card a link preview shows. It is public, like the page it describes. */
export const Route = createFileRoute("/v1/agent-templates/$templateId/card")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const object = await requestAgentTemplates().card(params.templateId);
          const headers = new Headers();
          object.writeHttpMetadata(headers);
          headers.set("Content-Type", "image/png");
          // Stored but checked on each use (a cheap 304 by ETag), so after an unpublish no cache
          // keeps showing the image.
          headers.set("Cache-Control", "public, no-cache");
          headers.set("ETag", object.httpEtag);
          headers.set("X-Content-Type-Options", "nosniff");
          return new Response(object.body, { headers });
        } catch (error) {
          return marketplaceErrorResponse(error);
        }
      },
    },
  },
});
