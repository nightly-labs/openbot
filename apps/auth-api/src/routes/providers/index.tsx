import { createFileRoute } from "@tanstack/solid-router";
import { ProvidersIndexPage } from "../../components/providers/ProvidersIndexPage";
import { collectionIndexHead } from "../../lib/content-metadata";
import { PROVIDERS_COLLECTION } from "../../lib/providers";

export const Route = createFileRoute("/providers/")({
  head: ({ match }) => collectionIndexHead(PROVIDERS_COLLECTION, match.context.siteUrl),
  component: ProvidersIndexRoute,
});

function ProvidersIndexRoute() {
  return <ProvidersIndexPage collection={PROVIDERS_COLLECTION} />;
}
