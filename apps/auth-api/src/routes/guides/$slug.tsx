import { createFileRoute, notFound } from "@tanstack/solid-router";
import { ArticlePage } from "../../components/content/ArticlePage";
import { type CollectionArticle, findArticle } from "../../lib/content-collection";
import { articleHead } from "../../lib/content-metadata";
import { GUIDES_COLLECTION } from "../../lib/guides";

// The same reason as on /news: the lookup is in `loader`, so an unknown slug ends
// as a real not-found response rather than a 200 that renders an error card.
export function loadGuide(slug: string): CollectionArticle {
  const guide = findArticle(GUIDES_COLLECTION, slug);
  if (!guide) throw notFound();
  return guide;
}

export const Route = createFileRoute("/guides/$slug")({
  loader: ({ params }) => loadGuide(params.slug),
  head: ({ loaderData, match }) =>
    loaderData ? articleHead(GUIDES_COLLECTION, loaderData, match.context.siteUrl) : {},
  component: GuideRoute,
});

function GuideRoute() {
  const guide = Route.useLoaderData();
  return <ArticlePage collection={GUIDES_COLLECTION} article={guide()} />;
}
