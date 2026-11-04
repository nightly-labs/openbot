import { createFileRoute } from "@tanstack/solid-router";
import { ContactPage } from "../components/contact/ContactPage";
import { CONTACT_ROUTE } from "../lib/contact";
import { OPENBOT_X_HANDLE, type PageSocialImage, pageSocialImageMeta } from "../lib/site-metadata";

const CONTACT_SOCIAL_IMAGE: PageSocialImage = {
  path: "/social/contact.jpg",
  alt: "Small team. Always on it. OpenBot agents around a paper planet",
};

const CONTACT_TITLE = "Contact the OpenBot team";
const CONTACT_DESCRIPTION =
  "Send the OpenBot team a message about a custom setup, a partnership or the press. A person reads each message.";

export const Route = createFileRoute("/contact")({
  head: ({ match }) => {
    const url = new URL(CONTACT_ROUTE, match.context.siteUrl).toString();
    const image = pageSocialImageMeta(CONTACT_SOCIAL_IMAGE, match.context.siteUrl);
    return {
      meta: [
        { title: CONTACT_TITLE },
        { name: "description", content: CONTACT_DESCRIPTION },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "OpenBot" },
        { property: "og:locale", content: "en_US" },
        { property: "og:url", content: url },
        { property: "og:title", content: CONTACT_TITLE },
        { property: "og:description", content: CONTACT_DESCRIPTION },
        ...image.openGraph,
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:site", content: OPENBOT_X_HANDLE },
        { name: "twitter:title", content: CONTACT_TITLE },
        { name: "twitter:description", content: CONTACT_DESCRIPTION },
        ...image.twitter,
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: ContactPage,
});
