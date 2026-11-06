import { createFileRoute } from "@tanstack/solid-router";
import { TeamsPage } from "../components/teams/TeamsPage";
import { teamsPageText } from "../components/teams/teams-page-text";
import { loadSitePage, siteLocale } from "../lib/site-locale";
import { sitePageHead } from "../lib/site-page-head";
import { TEAMS_ROUTE, TEAMS_SOCIAL_IMAGE_PATH } from "../lib/teams-page";

// The Teams page in the language of the request: Polish for Polish, English for all others.
// `/pl/teams` always shows Polish.
export const Route = createFileRoute("/teams")({
  loader: ({ context }) => loadSitePage(siteLocale(context.locale), teamsPageText),
  head: ({ match, loaderData }) => {
    if (!loaderData)
      return { links: [{ rel: "canonical", href: new URL(TEAMS_ROUTE, match.context.siteUrl).toString() }] };
    return sitePageHead(match.context.siteUrl, {
      page: TEAMS_ROUTE,
      path: TEAMS_ROUTE,
      locale: loaderData.site.locale,
      title: loaderData.text.title,
      description: loaderData.text.description,
      image: { path: TEAMS_SOCIAL_IMAGE_PATH, alt: loaderData.text.imageAlt },
    });
  },
  component: Teams,
});

function Teams() {
  const page = Route.useLoaderData();
  return <TeamsPage lang={page().lang} text={page().text} />;
}
