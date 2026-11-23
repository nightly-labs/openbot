import { marketplaceListingPath } from "@openbot/contracts/marketplace-links";
import { createFileRoute, notFound } from "@tanstack/solid-router";
import { MarketplaceAgentPage } from "../../../components/marketplace/MarketplaceListingPage";
import { MarketplaceMissingPage } from "../../../components/marketplace/MarketplaceMissingPage";
import {
  marketplaceListingHead,
  marketplaceListingHeaders,
  marketplaceMissingHead,
} from "../../../components/marketplace/marketplace-head";
import { marketplaceAgentText, marketplaceMissingText } from "../../../components/marketplace/marketplace-page-text";
import { readMarketplaceAgentListing } from "../../../lib/marketplace";
import { loadPageText } from "../../../lib/page-text";

export const Route = createFileRoute("/marketplace/agents/$agentId")({
  loader: async ({ context, params }) => {
    const listing = await readMarketplaceAgentListing({ data: params.agentId });
    if (!listing) throw notFound({ data: await loadPageText(context.locale, marketplaceMissingText) });
    const page = await loadPageText(context.locale, (t) => marketplaceAgentText(t, listing.agent));
    return { ...page, listing, textCatalog: page.locale };
  },
  head: ({ match, loaderData }) => {
    if (!loaderData) return marketplaceMissingHead(match.error);
    const agent = loaderData.listing.agent;
    return marketplaceListingHead(
      {
        path: marketplaceListingPath({ kind: "agent", id: agent.id }),
        text: loaderData.text,
        cardUrl: agent.cardUrl,
        pending: agent.pending === true,
      },
      match.context.siteUrl,
    );
  },
  headers: ({ loaderData }) => marketplaceListingHeaders(loaderData?.listing.agent.pending === true),
  component: MarketplaceAgentRoute,
  notFoundComponent: MarketplaceMissingPage,
});

function MarketplaceAgentRoute() {
  const page = Route.useLoaderData();
  return <MarketplaceAgentPage lang={page().lang} locale={page().locale} listing={page().listing} />;
}
