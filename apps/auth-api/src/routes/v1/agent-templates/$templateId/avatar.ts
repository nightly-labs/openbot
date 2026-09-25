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
          headers.set("Cache-Control", "public, max-age=300");
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
