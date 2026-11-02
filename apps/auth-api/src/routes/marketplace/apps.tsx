import { createFileRoute } from "@tanstack/solid-router";
import { MarketplaceIndexPage } from "../../components/marketplace/MarketplaceIndexPage";
import { marketplaceIndexHead } from "../../components/marketplace/marketplace-head";
import { marketplaceIndexText } from "../../components/marketplace/marketplace-page-text";
import { MARKETPLACE_APPS_ROUTE, marketplaceAppsSearch, withMarketplaceQuery } from "../../lib/marketplace-routes";
import { loadPageText } from "../../lib/page-text";

const NO_LISTINGS = [] as const;

/** The plugins that /plugins listed. They are in the site's code, so the page reads no database. */
export const Route = createFileRoute("/marketplace/apps")({
  validateSearch: marketplaceAppsSearch,
  loader: async ({ context }) => {
    const page = await loadPageText(context.locale, marketplaceIndexText);
    return { ...page, textCatalog: page.locale };
  },
  shouldReload: false,
  head: ({ match, loaderData }) =>
    marketplaceIndexHead(MARKETPLACE_APPS_ROUTE, match.context.siteUrl, loaderData?.text.apps),
  component: MarketplaceAppsRoute,
});

function MarketplaceAppsRoute() {
  const page = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const onQuery = (query: string) =>
    void navigate({ search: withMarketplaceQuery(query), replace: true, resetScroll: false });
  return (
    <MarketplaceIndexPage
      tab="apps"
      lang={page().lang}
      locale={page().locale}
      agents={NO_LISTINGS}
      skills={NO_LISTINGS}
      query={search().q}
      category={undefined}
      onQuery={onQuery}
    />
  );
}
