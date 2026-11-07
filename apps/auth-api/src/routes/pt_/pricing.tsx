import { createFileRoute } from "@tanstack/solid-router";
import { PricingPage } from "../../components/pricing/PricingPage";
import { pricingPageText } from "../../components/pricing/pricing-page-text";
import { readPricingOffer } from "../../lib/pricing-offer";
import { PRICING_ROUTE, PRICING_SOCIAL_IMAGE_PATH } from "../../lib/pricing-page";
import { loadSitePage } from "../../lib/site-locale";
import { sitePageHead } from "../../lib/site-page-head";
import { LOCALIZED_PAGE_PATHS } from "../../lib/site-paths";

// The pricing page in Brazilian Portuguese, whatever the language of the request.
export const Route = createFileRoute("/pt_/pricing")({
  loader: async () => {
    const [offer, page] = await Promise.all([readPricingOffer(), loadSitePage("pt", pricingPageText)]);
    // The order form reads the catalog in the browser too, so `getRouter` loads this one before hydration.
    return { ...page, offer, textCatalog: page.locale };
  },
  head: ({ match, loaderData }) => {
    const path = LOCALIZED_PAGE_PATHS.pt[PRICING_ROUTE];
    if (!loaderData) return { links: [{ rel: "canonical", href: new URL(path, match.context.siteUrl).toString() }] };
    return sitePageHead(match.context.siteUrl, {
      page: PRICING_ROUTE,
      path,
      locale: "pt",
      title: loaderData.text.title,
      description: loaderData.text.description,
      image: { path: PRICING_SOCIAL_IMAGE_PATH, alt: loaderData.text.imageAlt },
    });
  },
  // The VAT line depends on the visitor's country, so a shared cache must not keep the page.
  headers: () => ({ "Cache-Control": "no-store" }),
  component: PortuguesePricing,
});

function PortuguesePricing() {
  const page = Route.useLoaderData();
  return <PricingPage lang={page().lang} locale={page().locale} text={page().text} offer={page().offer} />;
}
