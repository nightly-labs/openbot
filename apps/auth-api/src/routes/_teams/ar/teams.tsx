import { createFileRoute } from "@tanstack/solid-router";
import { teamsPageText } from "../../../components/teams/teams-page-text";
import { loadSitePage } from "../../../lib/site-locale";
import { sitePageHead } from "../../../lib/site-page-head";
import { localizedPagePath } from "../../../lib/site-paths";
import { TEAMS_ROUTE, TEAMS_SOCIAL_IMAGE_PATH } from "../../../lib/teams-page";

export const Route = createFileRoute("/_teams/ar/teams")({
  loader: () => loadSitePage("ar", teamsPageText),
  head: ({ match, loaderData }) => {
    const path = localizedPagePath("ar", TEAMS_ROUTE);
    if (!loaderData) return { links: [{ rel: "canonical", href: new URL(path, match.context.siteUrl).toString() }] };
    return sitePageHead(match.context.siteUrl, {
      page: TEAMS_ROUTE,
      path,
      locale: "ar",
      title: loaderData.text.title,
      description: loaderData.text.description,
      image: { path: TEAMS_SOCIAL_IMAGE_PATH, alt: loaderData.text.imageAlt },
    });
  },
});
