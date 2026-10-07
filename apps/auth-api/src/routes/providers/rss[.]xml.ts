import { createFileRoute } from "@tanstack/solid-router";
import { PROVIDERS_COLLECTION } from "../../lib/providers";
import { contentRssResponse } from "../../server/content-feed";

export const Route = createFileRoute("/providers/rss.xml")({
  server: { handlers: { GET: () => contentRssResponse(PROVIDERS_COLLECTION) } },
});
