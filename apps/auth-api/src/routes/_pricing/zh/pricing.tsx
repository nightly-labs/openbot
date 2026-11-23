import { createFileRoute } from "@tanstack/solid-router";
import { pricingPageText } from "../../../components/pricing/pricing-page-text";
import { PRICING_ROUTE, PRICING_SOCIAL_IMAGE_PATH } from "../../../lib/pricing-page";
import { loadSitePage } from "../../../lib/site-locale";
import { sitePageHead } from "../../../lib/site-page-head";
import { localizedPagePath } from "../../../lib/site-paths";

export const Route = createFileRoute("/_pricing/zh/pricing")({
  loader: async () => {
    const page = await loadSitePage("zh", pricingPageText);
    return { ...page, textCatalog: page.locale };
  },
  head: ({ match, loaderData }) => {
    const path = localizedPagePath("zh", PRICING_ROUTE);
    if (!loaderData) return { links: [{ rel: "canonical", href: new URL(path, match.context.siteUrl).toString() }] };
    return sitePageHead(match.context.siteUrl, {
      page: PRICING_ROUTE,
      path,
      locale: "zh",
      title: loaderData.text.title,
      description: loaderData.text.description,
      image: { path: PRICING_SOCIAL_IMAGE_PATH, alt: loaderData.text.imageAlt },
    });
  },
});
