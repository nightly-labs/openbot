import { createFileRoute } from "@tanstack/solid-router";
import { PricingPage } from "../components/pricing/PricingPage";
import { pricingPageText } from "../components/pricing/pricing-page-text";
import { loadPageText } from "../lib/page-text";
import { readPricingOffer } from "../lib/pricing-offer";
import { PRICING_ROUTE, PRICING_SOCIAL_IMAGE_PATH } from "../lib/pricing-page";
import { loadSiteChrome, siteLocale } from "../lib/site-locale";
import { sitePageHead } from "../lib/site-page-head";

// The order form has text in every app language, so the page shows the language of the request. The header and
// the footer are in Polish for Polish and in English for all others. `/pl/pricing` always shows Polish.
export const Route = createFileRoute("/pricing")({
  loader: async ({ context }) => {
    const [offer, page, site] = await Promise.all([
      readPricingOffer(),
      loadPageText(context.locale, pricingPageText),
      loadSiteChrome(siteLocale(context.locale)),
    ]);
    // The order form reads the catalog in the browser too, so `getRouter` loads this one before hydration.
    return { ...page, offer, site, textCatalog: page.locale };
  },
  head: ({ match, loaderData }) => {
    if (!loaderData)
      return { links: [{ rel: "canonical", href: new URL(PRICING_ROUTE, match.context.siteUrl).toString() }] };
    return sitePageHead(match.context.siteUrl, {
      page: PRICING_ROUTE,
      path: PRICING_ROUTE,
      locale: loaderData.site.locale,
      title: loaderData.text.title,
      description: loaderData.text.description,
      image: { path: PRICING_SOCIAL_IMAGE_PATH, alt: loaderData.text.imageAlt },
    });
  },
  // The VAT line depends on the visitor's country, so a shared cache must not keep the page.
  headers: () => ({ "Cache-Control": "no-store" }),
  component: Pricing,
});

function Pricing() {
  const page = Route.useLoaderData();
  return <PricingPage lang={page().lang} locale={page().locale} text={page().text} offer={page().offer} />;
}
