import { createFileRoute } from "@tanstack/solid-router";
import { TermsPage } from "../components/legal/TermsPage";
import { OPENBOT_LEGAL_SOCIAL_IMAGE, OPENBOT_X_HANDLE, pageSocialImageMeta } from "../lib/site-metadata";
import { TERMS_META, TERMS_ROUTE } from "../lib/terms";

export const Route = createFileRoute("/terms")({
  head: ({ match }) => {
    const url = new URL(TERMS_ROUTE, match.context.siteUrl).toString();
    const { title, description } = TERMS_META;
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
  component: TermsPage,
});
