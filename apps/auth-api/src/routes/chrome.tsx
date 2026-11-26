import { X_EXTENSION_URL } from "@openbot/contracts/browser-extension-x";
import { createFileRoute } from "@tanstack/solid-router";
import { TransactionalPage } from "../components/transactional/TransactionalPage";
import { Button } from "../components/ui/button";
import { loadPageText } from "../lib/page-text";
import { OPENBOT_X_HANDLE, type PageSocialImage, pageSocialImageMeta } from "../lib/site-metadata";

/*
 * The link to share for the Chrome extension. A social site reads the card from the head; a
 * browser goes on to the Chrome Web Store at once. The body is for a browser that does not follow
 * the refresh.
 */

const CHROME_SOCIAL_IMAGE: PageSocialImage = {
  path: "/social/chrome-extension.jpg",
  alt: "One click away. OpenBot agents in a paper browser window",
};
const CHROME_TITLE = "OpenBot for Chrome";
const CHROME_DESCRIPTION =
  "Add the OpenBot extension to Chrome. Mention @openbot_ in a reply on X, and the extension sends the post to your X agent in OpenBot.";

export const Route = createFileRoute("/chrome")({
  loader: ({ context }) =>
    loadPageText(context.locale, (t) => ({
      title: t("marketplace.xApp.extensionName"),
      open: t("marketplace.xApp.extensionStepStore"),
    })),
  head: ({ match }) => {
    const url = new URL("/chrome", match.context.siteUrl).toString();
    const image = pageSocialImageMeta(CHROME_SOCIAL_IMAGE, match.context.siteUrl);
    return {
      meta: [
        { title: CHROME_TITLE },
        { "http-equiv": "refresh", content: `0; url=${X_EXTENSION_URL}` },
        { name: "robots", content: "noindex" },
        { name: "description", content: CHROME_DESCRIPTION },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "OpenBot" },
        { property: "og:locale", content: "en_US" },
        { property: "og:url", content: url },
        { property: "og:title", content: CHROME_TITLE },
        { property: "og:description", content: CHROME_DESCRIPTION },
        ...image.openGraph,
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:site", content: OPENBOT_X_HANDLE },
        { name: "twitter:title", content: CHROME_TITLE },
        { name: "twitter:description", content: CHROME_DESCRIPTION },
        ...image.twitter,
      ],
    };
  },
  headers: () => ({ "X-Robots-Tag": "noindex" }),
  component: ChromeExtensionRoute,
});

function ChromeExtensionRoute() {
  const page = Route.useLoaderData();
  return (
    <TransactionalPage titleId="chrome-extension-title" lang={page().lang}>
      <h1 id="chrome-extension-title">{page().text.title}</h1>
      <Button href={X_EXTENSION_URL} variant="primary" size="lg" icon="open">
        {page().text.open}
      </Button>
    </TransactionalPage>
  );
}
