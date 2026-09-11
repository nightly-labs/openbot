import { createFileRoute } from "@tanstack/solid-router";
import { CollectionIndexPage } from "../../components/content/CollectionIndexPage";
import { collectionIndexHead } from "../../lib/content-metadata";
import { NEWS_COLLECTION } from "../../lib/news";

export const Route = createFileRoute("/news/")({
  head: () => collectionIndexHead(NEWS_COLLECTION),
  component: NewsIndexRoute,
});

function NewsIndexRoute() {
  return <CollectionIndexPage collection={NEWS_COLLECTION} />;
}
