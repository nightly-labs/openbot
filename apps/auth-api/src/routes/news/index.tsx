import { createFileRoute } from "@tanstack/solid-router";
import { NewsIndexPage } from "../../components/news/NewsIndexPage";
import { openBotNewsIndexHead } from "../../lib/news-metadata";

export const Route = createFileRoute("/news/")({
  head: openBotNewsIndexHead,
  component: NewsIndexPage,
});
