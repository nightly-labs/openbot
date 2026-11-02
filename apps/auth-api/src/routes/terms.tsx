import { createFileRoute } from "@tanstack/solid-router";
import { TermsPage } from "../components/legal/TermsPage";
import { OPENBOT_SOCIAL_IMAGE_ALT, OPENBOT_SOCIAL_IMAGE_URL, OPENBOT_X_HANDLE } from "../lib/site-metadata";
import { TERMS_META, TERMS_ROUTE } from "../lib/terms";

export const Route = createFileRoute("/terms")({
  head: ({ match }) => {
    const url = new URL(TERMS_ROUTE, match.context.siteUrl).toString();
    const { title, description } = TERMS_META;
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
        { property: "og:image", content: OPENBOT_SOCIAL_IMAGE_URL },
        { property: "og:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:site", content: OPENBOT_X_HANDLE },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: OPENBOT_SOCIAL_IMAGE_URL },
        { name: "twitter:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: TermsPage,
});
