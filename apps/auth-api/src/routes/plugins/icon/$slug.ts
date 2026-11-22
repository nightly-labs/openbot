import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../server/effect-runtime";
import { pluginIconResponse } from "../../../server/plugin-icon";

export const Route = createFileRoute("/plugins/icon/$slug")({
  server: {
    handlers: {
      GET: async ({ request, params }) =>
        runApiEffect(pluginIconResponse(params.slug, new URL(request.url).searchParams.get("app"))),
    },
  },
});
