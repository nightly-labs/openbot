import { createFileRoute } from "@tanstack/solid-router";
import { CreditsPage } from "../components/credits/CreditsPage";
import { creditsPageText } from "../components/credits/credits-page-text";
import { CREDITS_ROUTE } from "../lib/credits-page";
import { loadPageText } from "../lib/page-text";
import { loadSiteChrome, siteLocale } from "../lib/site-locale";

export const Route = createFileRoute("/credits")({
  loader: async ({ context }) => {
    const [page, site] = await Promise.all([
      loadPageText(context.locale, creditsPageText),
      loadSiteChrome(siteLocale(context.locale)),
    ]);
    return { ...page, site };
  },
  head: ({ match, loaderData }) => {
    const url = new URL(CREDITS_ROUTE, match.context.siteUrl).toString();
    if (!loaderData) return { links: [{ rel: "canonical", href: url }] };
    const { title, description } = loaderData.text;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "OpenBot" },
        { property: "og:url", content: url },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: Credits,
});

function Credits() {
  const page = Route.useLoaderData();
  return <CreditsPage text={page().text} lang={page().lang} />;
}
