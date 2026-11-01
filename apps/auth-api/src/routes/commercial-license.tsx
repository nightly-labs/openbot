import { createFileRoute } from "@tanstack/solid-router";
import { CommercialLicensePage } from "../components/legal/CommercialLicensePage";
import { COMMERCIAL_LICENSE_META, COMMERCIAL_LICENSE_ROUTE } from "../lib/commercial-license";
import { OPENBOT_X_HANDLE, type PageSocialImage, pageSocialImageMeta } from "../lib/site-metadata";

const COMMERCIAL_LICENSE_SOCIAL_IMAGE: PageSocialImage = {
  path: "/social/commercial-license.jpg",
  alt: "Send the work. Your team delivers. OpenBot agents in a paper boat",
};

export const Route = createFileRoute("/commercial-license")({
  head: ({ match }) => {
    const url = new URL(COMMERCIAL_LICENSE_ROUTE, match.context.siteUrl).toString();
    const { title, description } = COMMERCIAL_LICENSE_META;
    const image = pageSocialImageMeta(COMMERCIAL_LICENSE_SOCIAL_IMAGE, match.context.siteUrl);
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
  component: CommercialLicensePage,
});
