import { createFileRoute, notFound } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { ComparisonPage } from "../../components/compare/ComparisonPage";
import { COMPARISONS } from "../../content/compare";
import { comparisonFaqStructuredData } from "../../content/compare/comparison";
import { COMPARE_COLLECTION } from "../../lib/compare";
import { type CollectionArticle, findArticle } from "../../lib/content-collection";
import { articleHead } from "../../lib/content-metadata";

// In `loader` for the reason given in routes/news/$slug.tsx: an unknown slug is a
// real not-found response, not a 200 with an error card.
export function loadComparison(slug: string): CollectionArticle {
  const article = findArticle(COMPARE_COLLECTION, slug);
  if (!article || !COMPARISONS[slug]) throw notFound();
  return article;
}

export const Route = createFileRoute("/compare/$slug")({
  loader: ({ params }) => loadComparison(params.slug),
  head: ({ loaderData, match }) => {
    if (!loaderData) return {};
    const head = articleHead(COMPARE_COLLECTION, loaderData, match.context.siteUrl, "featured");
    const comparison = COMPARISONS[loaderData.slug];
    if (!comparison) return head;
    return { ...head, meta: [...head.meta, { "script:ld+json": comparisonFaqStructuredData(comparison) }] };
  },
  component: ComparisonRoute,
});

function ComparisonRoute() {
  const article = Route.useLoaderData();
  return (
    <Show when={COMPARISONS[article().slug]}>
      {(comparison) => <ComparisonPage collection={COMPARE_COLLECTION} article={article()} comparison={comparison()} />}
    </Show>
  );
}
