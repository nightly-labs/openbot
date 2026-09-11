import { createFileRoute } from "@tanstack/solid-router";
import { NEWS_COLLECTION } from "../../lib/news";
import { contentRssResponse } from "../../server/content-feed";

export const Route = createFileRoute("/news/rss.xml")({
  server: { handlers: { GET: () => contentRssResponse(NEWS_COLLECTION) } },
});
