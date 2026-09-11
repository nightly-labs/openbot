import { createFileRoute } from "@tanstack/solid-router";
import { newsRssResponse } from "../../server/news-feed";

export const Route = createFileRoute("/news/rss.xml")({
  server: { handlers: { GET: newsRssResponse } },
});
