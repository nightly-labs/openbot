import { createFileRoute } from "@tanstack/solid-router";
import { pluginIconResponse } from "../../../server/plugin-icon";

/**
 * `/plugins/icon/<slug>`, and `?app=<id>` for one of the listing's apps. Three segments, so it never
 * competes with `/plugins/<slug>`.
 */
export const Route = createFileRoute("/plugins/icon/$slug")({
  server: {
    handlers: {
      GET: async ({ request, params }) => pluginIconResponse(params.slug, new URL(request.url).searchParams.get("app")),
    },
  },
});
