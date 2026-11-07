import { marketplaceListingPath } from "@openbot/contracts/marketplace-links";
import { createFileRoute, notFound } from "@tanstack/solid-router";
import { MarketplaceSkillPage } from "../../../components/marketplace/MarketplaceListingPage";
import { MarketplaceMissingPage } from "../../../components/marketplace/MarketplaceMissingPage";
import { marketplaceListingHead, marketplaceMissingHead } from "../../../components/marketplace/marketplace-head";
import { marketplaceMissingText, marketplaceSkillText } from "../../../components/marketplace/marketplace-page-text";
import { readMarketplaceSkill } from "../../../lib/marketplace";
import { loadPageText } from "../../../lib/page-text";

/** One approved skill. Any other slug is a 404: a skill has no page before its review. */
export const Route = createFileRoute("/marketplace/skills/$slug")({
  loader: async ({ context, params }) => {
    const skill = await readMarketplaceSkill({ data: params.slug });
    if (!skill) throw notFound({ data: await loadPageText(context.locale, marketplaceMissingText) });
    const page = await loadPageText(context.locale, (t) => marketplaceSkillText(t, skill));
    return { ...page, skill, textCatalog: page.locale };
  },
  head: ({ match, loaderData }) => {
    if (!loaderData) return marketplaceMissingHead(match.error);
    const skill = loaderData.skill;
    return marketplaceListingHead(
      {
        path: marketplaceListingPath({ kind: "skill", id: skill.slug }),
        text: loaderData.text,
        cardUrl: skill.cardUrl,
        pending: false,
      },
      match.context.siteUrl,
    );
  },
  component: MarketplaceSkillRoute,
  notFoundComponent: MarketplaceMissingPage,
});

function MarketplaceSkillRoute() {
  const page = Route.useLoaderData();
  return <MarketplaceSkillPage lang={page().lang} locale={page().locale} skill={page().skill} />;
}
