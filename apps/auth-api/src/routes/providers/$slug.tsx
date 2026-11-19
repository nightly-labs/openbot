import { createFileRoute, notFound } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { ProviderArticlePage } from "../../components/providers/ProviderArticlePage";
import { PROVIDER_PAGES } from "../../content/providers";
import { type CollectionArticle, findArticle } from "../../lib/content-collection";
import { articleHead } from "../../lib/content-metadata";
import { PROVIDERS_COLLECTION } from "../../lib/providers";

async function loadProvider(slug: string): Promise<CollectionArticle> {
  const article = findArticle(PROVIDERS_COLLECTION, slug);
  const { PROVIDER_PAGES } = await import("../../content/providers");
  if (!article || !PROVIDER_PAGES[slug]) throw notFound();
  return article;
}

export const Route = createFileRoute("/providers/$slug")({
  loader: ({ params }) => loadProvider(params.slug),
  head: async ({ loaderData, match }) => {
    if (!loaderData) return {};
    const head = articleHead(PROVIDERS_COLLECTION, loaderData, match.context.siteUrl, "featured");
    const [{ PROVIDER_PAGES }, { comparisonFaqStructuredData }] = await Promise.all([
      import("../../content/providers"),
      import("../../content/compare/comparison"),
    ]);
    const page = PROVIDER_PAGES[loaderData.slug];
    if (!page) return head;
    return { ...head, meta: [...head.meta, { "script:ld+json": comparisonFaqStructuredData(page) }] };
  },
  component: ProviderRoute,
});

function ProviderRoute() {
  const article = Route.useLoaderData();
  return (
    <Show when={PROVIDER_PAGES[article().slug]} keyed>
      {(page) => <ProviderArticlePage collection={PROVIDERS_COLLECTION} article={article()} page={page} />}
    </Show>
  );
}
