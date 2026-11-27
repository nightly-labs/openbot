import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/v1/plugins/catalog")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { pluginCatalogResponse } = await import("../../../lib/plugin-catalog-response");
        return pluginCatalogResponse(request);
      },
    },
  },
});
