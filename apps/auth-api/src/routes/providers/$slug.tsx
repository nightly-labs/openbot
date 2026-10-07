import { createFileRoute, notFound } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { ProviderArticlePage } from "../../components/providers/ProviderArticlePage";
import { comparisonFaqStructuredData } from "../../content/compare/comparison";
import { PROVIDER_PAGES } from "../../content/providers";
import { type CollectionArticle, findArticle } from "../../lib/content-collection";
import { articleHead } from "../../lib/content-metadata";
import { PROVIDERS_COLLECTION } from "../../lib/providers";

// In `loader` for the reason given in routes/news/$slug.tsx: an unknown slug is a
// real not-found response, not a 200 with an error card.
export function loadProvider(slug: string): CollectionArticle {
  const article = findArticle(PROVIDERS_COLLECTION, slug);
  if (!article || !PROVIDER_PAGES[slug]) throw notFound();
  return article;
}

export const Route = createFileRoute("/providers/$slug")({
  loader: ({ params }) => loadProvider(params.slug),
  head: ({ loaderData, match }) => {
    if (!loaderData) return {};
    const head = articleHead(PROVIDERS_COLLECTION, loaderData, match.context.siteUrl, "featured");
    const page = PROVIDER_PAGES[loaderData.slug];
    if (!page) return head;
    return { ...head, meta: [...head.meta, { "script:ld+json": comparisonFaqStructuredData(page) }] };
  },
  component: ProviderRoute,
});

function ProviderRoute() {
  const article = Route.useLoaderData();
  return (
    // Keyed: a link from one provider page to another keeps this route mounted, so
    // each page gets a fresh tree, as on /compare.
    <Show when={PROVIDER_PAGES[article().slug]} keyed>
      {(page) => <ProviderArticlePage collection={PROVIDERS_COLLECTION} article={article()} page={page} />}
    </Show>
  );
}
