import { createFileRoute } from "@tanstack/solid-router";
import { movedPermanently } from "../../../server/moved-content";

// Social sites cached the preview image of the old news article.
export const Route = createFileRoute("/news/og/openbot-vs-grokbot.png")({
  server: { handlers: { GET: () => movedPermanently("/compare/og/grok-bot.png") } },
});
