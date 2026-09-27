import { createFileRoute } from "@tanstack/solid-router";
import { CompareIndexPage } from "../../components/compare/CompareIndexPage";
import { COMPARE_COLLECTION } from "../../lib/compare";
import { collectionIndexHead } from "../../lib/content-metadata";

export const Route = createFileRoute("/compare/")({
  head: ({ match }) => collectionIndexHead(COMPARE_COLLECTION, match.context.siteUrl),
  component: CompareIndexRoute,
});

function CompareIndexRoute() {
  return <CompareIndexPage collection={COMPARE_COLLECTION} />;
}
