import { createFileRoute } from "@tanstack/solid-router";
import { MarketplaceIndexPage } from "../../../components/marketplace/MarketplaceIndexPage";
import { marketplaceIndexHead } from "../../../components/marketplace/marketplace-head";
import { marketplaceIndexText } from "../../../components/marketplace/marketplace-page-text";
import { readMarketplaceSkills } from "../../../lib/marketplace";
import { MARKETPLACE_SKILLS_ROUTE, marketplaceSearch, withMarketplaceQuery } from "../../../lib/marketplace-routes";
import { loadPageText } from "../../../lib/page-text";

const NO_AGENTS = [] as const;

export const Route = createFileRoute("/marketplace/skills/")({
  validateSearch: marketplaceSearch,
  loader: async ({ context }) => {
    const [skills, page] = await Promise.all([
      readMarketplaceSkills(),
      loadPageText(context.locale, marketplaceIndexText),
    ]);
    return { ...page, skills, textCatalog: page.locale };
  },
  // The search and the category filter the list on the page. Neither reads the catalog again.
  shouldReload: false,
  head: ({ match, loaderData }) =>
    marketplaceIndexHead(MARKETPLACE_SKILLS_ROUTE, match.context.siteUrl, loaderData?.text.skills),
  component: MarketplaceSkillsRoute,
});

function MarketplaceSkillsRoute() {
  const page = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const onQuery = (query: string) =>
    void navigate({ search: withMarketplaceQuery(query), replace: true, resetScroll: false });
  return (
    <MarketplaceIndexPage
      tab="skills"
      lang={page().lang}
      locale={page().locale}
      agents={NO_AGENTS}
      skills={page().skills}
      query={search().q}
      category={search().category}
      onQuery={onQuery}
    />
  );
}
