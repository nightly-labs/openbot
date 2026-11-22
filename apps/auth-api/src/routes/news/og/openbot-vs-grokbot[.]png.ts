import { createFileRoute } from "@tanstack/solid-router";
import { movedPermanently } from "../../../server/moved-content";

export const Route = createFileRoute("/news/og/openbot-vs-grokbot.png")({
  server: { handlers: { GET: () => movedPermanently("/compare/og/grok-bot.png") } },
});
