import { createFileRoute } from "@tanstack/solid-router";
import { DpaPage } from "../components/legal/DpaPage";
import { DPA_META, DPA_ROUTE } from "../lib/dpa";
import { OPENBOT_LEGAL_SOCIAL_IMAGE, OPENBOT_X_HANDLE, pageSocialImageMeta } from "../lib/site-metadata";

export const Route = createFileRoute("/dpa")({
  head: ({ match }) => {
    const url = new URL(DPA_ROUTE, match.context.siteUrl).toString();
    const { title, description } = DPA_META;
    const image = pageSocialImageMeta(OPENBOT_LEGAL_SOCIAL_IMAGE, match.context.siteUrl);
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
  component: DpaPage,
});
