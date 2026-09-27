import { createFileRoute } from "@tanstack/solid-router";
import { COMPARE_COLLECTION } from "../../lib/compare";
import { contentRssResponse } from "../../server/content-feed";

export const Route = createFileRoute("/compare/rss.xml")({
  server: { handlers: { GET: () => contentRssResponse(COMPARE_COLLECTION) } },
});
