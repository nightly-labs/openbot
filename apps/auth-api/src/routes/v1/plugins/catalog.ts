import { createFileRoute } from "@tanstack/solid-router";
import { pluginCatalogResponse } from "../../../lib/plugin-catalog-response";

export const Route = createFileRoute("/v1/plugins/catalog")({
  server: {
    handlers: {
      GET: ({ request }) => pluginCatalogResponse(request),
    },
  },
});
