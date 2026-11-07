import { createFileRoute } from "@tanstack/solid-router";
import { pricingPageText } from "../../components/pricing/pricing-page-text";
import { loadPageText } from "../../lib/page-text";
import { PRICING_ROUTE, PRICING_SOCIAL_IMAGE_PATH } from "../../lib/pricing-page";
import { loadSiteChrome, siteLocale } from "../../lib/site-locale";
import { sitePageHead } from "../../lib/site-page-head";

// The order form has text in every app language, so the page shows the language of the request. The header and
// the footer are in Polish for Polish, in Brazilian Portuguese for Portuguese, and in English for all others.
// `/pl/pricing` always shows Polish, and `/pt/pricing` Portuguese.
export const Route = createFileRoute("/_pricing/pricing")({
  loader: async ({ context }) => {
    const [page, site] = await Promise.all([
      loadPageText(context.locale, pricingPageText),
      loadSiteChrome(siteLocale(context.locale)),
    ]);
    // The order form reads the catalog in the browser too, so `getRouter` loads this one before hydration.
    return { ...page, site, textCatalog: page.locale };
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
});
