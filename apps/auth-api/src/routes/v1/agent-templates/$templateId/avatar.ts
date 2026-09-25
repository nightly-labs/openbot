import { createFileRoute } from "@tanstack/solid-router";
import { marketplaceErrorResponse, requestAgentTemplates } from "../../../../server/request-auth";

export const Route = createFileRoute("/v1/agent-templates/$templateId/avatar")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const object = await requestAgentTemplates().avatar(params.templateId);
          const headers = new Headers();
          object.writeHttpMetadata(headers);
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
