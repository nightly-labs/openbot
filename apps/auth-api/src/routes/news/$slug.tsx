import { createFileRoute, notFound } from "@tanstack/solid-router";
import { NewsArticlePage } from "../../components/news/NewsArticlePage";
import { findNewsArticle, type NewsArticle } from "../../lib/news";
import { openBotArticleHead } from "../../lib/news-metadata";

// The lookup is in `loader` rather than in the component so an unknown slug ends
// as a real not-found response instead of a 200 that renders an error card. A
// crawler treats those two very differently.
export function loadNewsArticle(slug: string): NewsArticle {
  const article = findNewsArticle(slug);
  if (!article) throw notFound();
  return article;
}

export const Route = createFileRoute("/news/$slug")({
  loader: ({ params }) => loadNewsArticle(params.slug),
  head: ({ loaderData }) => (loaderData ? openBotArticleHead(loaderData) : {}),
  component: NewsArticleRoute,
});

function NewsArticleRoute() {
  const article = Route.useLoaderData();
  return <NewsArticlePage article={article()} />;
}
