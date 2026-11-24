import { createFileRoute, notFound, redirect } from "@tanstack/solid-router";
import { ArticlePage } from "../../components/content/ArticlePage";
import { type CollectionArticle, findArticle } from "../../lib/content-collection";
import { articleHead } from "../../lib/content-metadata";
import { GUIDES_COLLECTION } from "../../lib/guides";

function loadGuide(slug: string): CollectionArticle {
  const guide = findArticle(GUIDES_COLLECTION, slug);
  if (!guide) throw notFound();
  return guide;
}

export const Route = createFileRoute("/guides/$slug")({
  loader: ({ params }) => {
    if (params.slug === "write-a-guide-for-openbot") {
      throw redirect({
        href: "https://github.com/nightly-labs/openbot/blob/main/CONTRIBUTING.md",
        statusCode: 308,
      });
    }

    return loadGuide(params.slug);
  },
  head: ({ loaderData, match }) =>
    loaderData ? articleHead(GUIDES_COLLECTION, loaderData, match.context.siteUrl) : {},
  component: GuideRoute,
});

function GuideRoute() {
  const guide = Route.useLoaderData();
  return <ArticlePage collection={GUIDES_COLLECTION} article={guide()} />;
}
