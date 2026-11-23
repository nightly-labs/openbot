import { createFileRoute, notFound } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { CompareArticlePage } from "../../components/compare/CompareArticlePage";
import { COMPARISONS } from "../../content/compare";
import { COMPARE_COLLECTION } from "../../lib/compare";
import { articleUrl, type CollectionArticle, findArticle } from "../../lib/content-collection";
import { articleHead } from "../../lib/content-metadata";

async function loadComparison(slug: string): Promise<CollectionArticle> {
  const article = findArticle(COMPARE_COLLECTION, slug);
  const { COMPARISONS } = await import("../../content/compare");
  if (!article || !COMPARISONS[slug]) throw notFound();
  return article;
}

export const Route = createFileRoute("/compare/$slug")({
  loader: ({ params }) => loadComparison(params.slug),
  head: async ({ loaderData, match }) => {
    if (!loaderData) return {};
    const head = articleHead(COMPARE_COLLECTION, loaderData, match.context.siteUrl, "featured");
    const [{ COMPARISONS }, { comparisonFaqStructuredData, roundupAppAnchor, roundupItemListStructuredData }] =
      await Promise.all([import("../../content/compare"), import("../../content/compare/comparison")]);
    const page = COMPARISONS[loaderData.slug];
    if (!page) return head;
    const siteUrl = match.context.siteUrl;
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
    <Show when={COMPARISONS[article().slug]} keyed>
      {(page) => <CompareArticlePage collection={COMPARE_COLLECTION} article={article()} page={page} />}
    </Show>
  );
}
