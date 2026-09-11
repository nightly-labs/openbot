import { createFileRoute, notFound } from "@tanstack/solid-router";
import { ArticlePage } from "../../components/content/ArticlePage";
import { type CollectionArticle, findArticle } from "../../lib/content-collection";
import { articleHead } from "../../lib/content-metadata";
import { NEWS_COLLECTION } from "../../lib/news";

// The lookup is in `loader` rather than in the component so an unknown slug ends
// as a real not-found response instead of a 200 that renders an error card. A
// crawler treats those two very differently.
export function loadNewsArticle(slug: string): CollectionArticle {
  const article = findArticle(NEWS_COLLECTION, slug);
  if (!article) throw notFound();
  return article;
}

export const Route = createFileRoute("/news/$slug")({
  loader: ({ params }) => loadNewsArticle(params.slug),
  head: ({ loaderData }) => (loaderData ? articleHead(NEWS_COLLECTION, loaderData) : {}),
  component: NewsArticleRoute,
});

function NewsArticleRoute() {
  const article = Route.useLoaderData();
  return <ArticlePage collection={NEWS_COLLECTION} article={article()} />;
}
