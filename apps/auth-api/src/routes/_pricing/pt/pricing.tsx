import { createFileRoute } from "@tanstack/solid-router";
import { pricingPageText } from "../../../components/pricing/pricing-page-text";
import { PRICING_ROUTE, PRICING_SOCIAL_IMAGE_PATH } from "../../../lib/pricing-page";
import { loadSitePage } from "../../../lib/site-locale";
import { sitePageHead } from "../../../lib/site-page-head";
import { LOCALIZED_PAGE_PATHS } from "../../../lib/site-paths";

// The pricing page in Brazilian Portuguese, whatever the language of the request.
export const Route = createFileRoute("/_pricing/pt/pricing")({
  loader: async () => {
    const page = await loadSitePage("pt", pricingPageText);
    // The order form reads the catalog in the browser too, so `getRouter` loads this one before hydration.
    return { ...page, textCatalog: page.locale };
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
});
