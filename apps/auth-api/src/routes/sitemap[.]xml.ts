import { createFileRoute } from "@tanstack/solid-router";
import { newsSitemapResponse } from "../server/news-feed";

export const Route = createFileRoute("/sitemap.xml")({
  server: { handlers: { GET: newsSitemapResponse } },
});
