import { createFileRoute } from "@tanstack/solid-router";
import { contentSitemapResponse } from "../server/content-feed";

export const Route = createFileRoute("/sitemap.xml")({
  server: { handlers: { GET: contentSitemapResponse } },
});
