import { createFileRoute } from "@tanstack/solid-router";
import { JoinPage } from "../components/landing/JoinPage";
import { joinPageText } from "../components/transactional/page-text";
import { loadPageText } from "../lib/page-text";
import { OPENBOT_X_HANDLE, type PageSocialImage, pageSocialImageMeta } from "../lib/site-metadata";

const JOIN_SOCIAL_IMAGE: PageSocialImage = {
  path: "/social/join.jpg",
  alt: "Good ideas. Made together. OpenBot agents around a glass table",
};

export const Route = createFileRoute("/join")({
  loader: ({ context }) => loadPageText(context.locale, joinPageText),
  head: ({ match, loaderData }) => {
    // Only the path: the query holds the invitation token, and a link preview must not copy it.
    const url = new URL("/join", match.context.siteUrl).toString();
    const text = loaderData?.text;
    if (!text) {
      return {
        meta: [
          { name: "robots", content: "noindex, nofollow, noarchive" },
          { name: "referrer", content: "no-referrer" },
        ],
      };
    }
    const image = pageSocialImageMeta(JOIN_SOCIAL_IMAGE, match.context.siteUrl);
    return {
      meta: [
        { title: text.title },
        { name: "robots", content: "noindex, nofollow, noarchive" },
        { name: "referrer", content: "no-referrer" },
        { name: "description", content: text.description },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "OpenBot" },
        { property: "og:locale", content: "en_US" },
        { property: "og:url", content: url },
        { property: "og:title", content: text.title },
        { property: "og:description", content: text.description },
        ...image.openGraph,
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:site", content: OPENBOT_X_HANDLE },
        { name: "twitter:title", content: text.title },
        { name: "twitter:description", content: text.description },
        ...image.twitter,
      ],
    };
  },
  headers: () => ({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  }),
  component: Join,
});

function Join() {
  const page = Route.useLoaderData();
  return <JoinPage lang={page().lang} text={page().text} />;
}
