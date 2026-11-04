import { createFileRoute } from "@tanstack/solid-router";
import { PricingPage } from "../components/pricing/PricingPage";
import { pricingPageText } from "../components/pricing/pricing-page-text";
import { loadPageText } from "../lib/page-text";
import { readPricingOffer } from "../lib/pricing-offer";
import { PRICING_ROUTE, PRICING_SOCIAL_IMAGE } from "../lib/pricing-page";
import { OPENBOT_X_HANDLE, pageSocialImageMeta } from "../lib/site-metadata";

export const Route = createFileRoute("/pricing")({
  loader: async ({ context }) => {
    const offer = await readPricingOffer();
    const page = await loadPageText(context.locale, pricingPageText);
    // The order form reads the catalog in the browser too, so `getRouter` loads this one before hydration.
    return { ...page, offer, textCatalog: page.locale };
  },
  head: ({ match, loaderData }) => {
    const url = new URL(PRICING_ROUTE, match.context.siteUrl).toString();
    const text = loaderData?.text;
    if (!text) return { links: [{ rel: "canonical", href: url }] };
    const image = pageSocialImageMeta(PRICING_SOCIAL_IMAGE, match.context.siteUrl);
    return {
      meta: [
        { title: text.title },
        { name: "description", content: text.description },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "OpenBot" },
        { property: "og:locale", content: "en_US" },
        { property: "og:url", content: url },
        { property: "og:title", content: text.title },
        { property: "og:description", content: text.description },
        ...image.openGraph,
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:site", content: OPENBOT_X_HANDLE },
        { name: "twitter:title", content: text.title },
        { name: "twitter:description", content: text.description },
        ...image.twitter,
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  // The VAT line depends on the visitor's country, so a shared cache must not keep the page.
  headers: () => ({ "Cache-Control": "no-store" }),
  component: Pricing,
});

function Pricing() {
  const page = Route.useLoaderData();
  return <PricingPage lang={page().lang} locale={page().locale} text={page().text} offer={page().offer} />;
}
