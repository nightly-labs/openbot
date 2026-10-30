import { createFileRoute } from "@tanstack/solid-router";
import { PricingPage } from "../components/pricing/PricingPage";
import { pricingPageText } from "../components/pricing/pricing-page-text";
import { loadPageText } from "../lib/page-text";
import { readPricingOffer } from "../lib/pricing-offer";
import { PRICING_ROUTE } from "../lib/pricing-page";
import { OPENBOT_SOCIAL_IMAGE_ALT, OPENBOT_SOCIAL_IMAGE_URL, OPENBOT_X_HANDLE } from "../lib/site-metadata";

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
        { property: "og:image", content: OPENBOT_SOCIAL_IMAGE_URL },
        { property: "og:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:site", content: OPENBOT_X_HANDLE },
        { name: "twitter:title", content: text.title },
        { name: "twitter:description", content: text.description },
        { name: "twitter:image", content: OPENBOT_SOCIAL_IMAGE_URL },
        { name: "twitter:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
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
