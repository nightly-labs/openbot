import { createFileRoute } from "@tanstack/solid-router";
import { TeamsPage } from "../../components/teams/TeamsPage";
import { teamsPageText } from "../../components/teams/teams-page-text";
import { loadSitePage } from "../../lib/site-locale";
import { sitePageHead } from "../../lib/site-page-head";
import { LOCALIZED_PAGE_PATHS } from "../../lib/site-paths";
import { TEAMS_ROUTE, TEAMS_SOCIAL_IMAGE_PATH } from "../../lib/teams-page";

// The Teams page in Brazilian Portuguese, whatever the language of the request.
export const Route = createFileRoute("/pt_/teams")({
  loader: () => loadSitePage("pt", teamsPageText),
  head: ({ match, loaderData }) => {
    const path = LOCALIZED_PAGE_PATHS.pt[TEAMS_ROUTE];
    if (!loaderData) return { links: [{ rel: "canonical", href: new URL(path, match.context.siteUrl).toString() }] };
    return sitePageHead(match.context.siteUrl, {
      page: TEAMS_ROUTE,
      path,
      locale: "pt",
      title: loaderData.text.title,
      description: loaderData.text.description,
      image: { path: TEAMS_SOCIAL_IMAGE_PATH, alt: loaderData.text.imageAlt },
    });
  },
  component: PortugueseTeams,
});

function PortugueseTeams() {
  const page = Route.useLoaderData();
  return <TeamsPage lang={page().lang} text={page().text} />;
}
