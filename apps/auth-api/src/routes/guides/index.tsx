import { createFileRoute } from "@tanstack/solid-router";
import { CollectionIndexPage } from "../../components/content/CollectionIndexPage";
import { collectionIndexHead } from "../../lib/content-metadata";
import { GUIDES_COLLECTION } from "../../lib/guides";

export const Route = createFileRoute("/guides/")({
  head: ({ match }) => collectionIndexHead(GUIDES_COLLECTION, match.context.siteUrl),
  component: GuidesIndexRoute,
});

function GuidesIndexRoute() {
  return <CollectionIndexPage collection={GUIDES_COLLECTION} />;
}
