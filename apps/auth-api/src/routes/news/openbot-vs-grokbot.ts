import { createFileRoute } from "@tanstack/solid-router";
import { movedPermanently } from "../../server/moved-content";

// The comparison was a news article before /compare existed. A static segment wins over `$slug`.
export const Route = createFileRoute("/news/openbot-vs-grokbot")({
  server: { handlers: { GET: () => movedPermanently("/compare/grok-bot") } },
});
