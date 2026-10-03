import { createFileRoute, notFound } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { CompareArticlePage } from "../../components/compare/CompareArticlePage";
import { COMPARISONS } from "../../content/compare";
import {
  comparisonFaqStructuredData,
  roundupAppAnchor,
  roundupItemListStructuredData,
} from "../../content/compare/comparison";
import { COMPARE_COLLECTION } from "../../lib/compare";
import { articleUrl, type CollectionArticle, findArticle } from "../../lib/content-collection";
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
    const page = COMPARISONS[loaderData.slug];
    if (!page) return head;
    const siteUrl = match.context.siteUrl;
    // Each app in a roundup points to its own entry on the page, so no two items share
    // a URL. OpenBot points to the home page.
    const pageUrl = articleUrl(COMPARE_COLLECTION, loaderData.slug, siteUrl);
    const itemList =
      page.kind === "roundup"
        ? [
            roundupItemListStructuredData(page, loaderData.title, (app) =>
              app.mark === "openbot" ? new URL("/", siteUrl).toString() : `${pageUrl}#${roundupAppAnchor(app)}`,
            ),
          ]
        : [];
    return {
      ...head,
      meta: [
        ...head.meta,
        { "script:ld+json": comparisonFaqStructuredData(page) },
        ...itemList.map((data) => ({ "script:ld+json": data })),
      ],
    };
  },
  component: ComparisonRoute,
});

function ComparisonRoute() {
  const article = Route.useLoaderData();
  return (
    <Show when={COMPARISONS[article().slug]}>
      {(page) => <CompareArticlePage collection={COMPARE_COLLECTION} article={article()} page={page()} />}
    </Show>
  );
}
