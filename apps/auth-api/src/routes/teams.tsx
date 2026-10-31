import { createFileRoute } from "@tanstack/solid-router";
import { TeamsPage } from "../components/teams/TeamsPage";
import { OPENBOT_X_HANDLE, pageSocialImageMeta } from "../lib/site-metadata";
import { TEAMS_PAGE_META, TEAMS_ROUTE, TEAMS_SOCIAL_IMAGE } from "../lib/teams-page";

export const Route = createFileRoute("/teams")({
  head: ({ match }) => {
    const url = new URL(TEAMS_ROUTE, match.context.siteUrl).toString();
    const { title, description } = TEAMS_PAGE_META;
    const image = pageSocialImageMeta(TEAMS_SOCIAL_IMAGE, match.context.siteUrl);
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "OpenBot" },
        { property: "og:locale", content: "en_US" },
        { property: "og:url", content: url },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        ...image.openGraph,
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:site", content: OPENBOT_X_HANDLE },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        ...image.twitter,
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: TeamsPage,
});
