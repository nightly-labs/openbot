import { createFileRoute } from "@tanstack/solid-router";
import { MarketplaceIndexPage } from "../../components/marketplace/MarketplaceIndexPage";
import { marketplaceIndexHead } from "../../components/marketplace/marketplace-head";
import { marketplaceIndexText } from "../../components/marketplace/marketplace-page-text";
import { readMarketplaceAgents } from "../../lib/marketplace";
import { MARKETPLACE_ROUTE, marketplaceSearch, withMarketplaceQuery } from "../../lib/marketplace-routes";
import { loadPageText } from "../../lib/page-text";

const NO_SKILLS = [] as const;

export const Route = createFileRoute("/marketplace/")({
  validateSearch: marketplaceSearch,
  loader: async ({ context }) => {
    const [agents, page] = await Promise.all([
      readMarketplaceAgents(),
      loadPageText(context.locale, marketplaceIndexText),
    ]);
    return { ...page, agents, textCatalog: page.locale };
  },
  shouldReload: false,
  head: ({ match, loaderData }) =>
    marketplaceIndexHead(MARKETPLACE_ROUTE, match.context.siteUrl, loaderData?.text.agents),
  component: MarketplaceAgentsRoute,
});

function MarketplaceAgentsRoute() {
  const page = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const onQuery = (query: string) =>
    void navigate({ search: withMarketplaceQuery(query), replace: true, resetScroll: false });
  return (
    <MarketplaceIndexPage
      tab="agents"
      lang={page().lang}
      locale={page().locale}
      agents={page().agents}
      skills={NO_SKILLS}
      query={search().q}
      category={search().category}
      onQuery={onQuery}
    />
  );
}
