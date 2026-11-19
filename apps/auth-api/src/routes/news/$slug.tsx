import { createFileRoute, notFound } from "@tanstack/solid-router";
import { ArticlePage } from "../../components/content/ArticlePage";
import { type CollectionArticle, findArticle } from "../../lib/content-collection";
import { articleHead } from "../../lib/content-metadata";
import { NEWS_COLLECTION } from "../../lib/news";

function loadNewsArticle(slug: string): CollectionArticle {
  const article = findArticle(NEWS_COLLECTION, slug);
  if (!article) throw notFound();
  return article;
}

export const Route = createFileRoute("/news/$slug")({
  loader: ({ params }) => loadNewsArticle(params.slug),
  head: ({ loaderData, match }) => (loaderData ? articleHead(NEWS_COLLECTION, loaderData, match.context.siteUrl) : {}),
  component: NewsArticleRoute,
});

function NewsArticleRoute() {
  const article = Route.useLoaderData();
  return <ArticlePage collection={NEWS_COLLECTION} article={article()} />;
}
