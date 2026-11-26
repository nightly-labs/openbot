import { X_EXTENSION_URL } from "@openbot/contracts/browser-extension-x";
import { OPENBOT_X_HANDLE, type PageSocialImage, pageSocialImageMeta, siteUrlForPage } from "../lib/site-metadata";

const EXTENSION_TITLE = "OpenBot for Chrome";
const EXTENSION_DESCRIPTION =
  "Chat with your OpenBot agents beside any page. Add the OpenBot extension to Chrome from the Chrome Web Store.";

const EXTENSION_SOCIAL_IMAGE: PageSocialImage = {
  path: "/social/chrome-extension.jpg",
  alt: "One click away. OpenBot agents around a paper browser window",
};

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function metaTag(key: "name" | "property", id: string, content: string): string {
  return `<meta ${key}="${id}" content="${escapeAttribute(content)}">`;
}

function socialImageTags(siteUrl: string) {
  const image = pageSocialImageMeta(EXTENSION_SOCIAL_IMAGE, siteUrl);
  return {
    openGraph: image.openGraph.map((tag) => metaTag("property", tag.property, tag.content)),
    twitter: image.twitter.map((tag) => metaTag("name", tag.name, tag.content)),
  };
}

export function extensionLinkResponse(request: Request): Response {
  const siteUrl = siteUrlForPage(new URL(request.url));
  const pageUrl = new URL("/chrome-extension", siteUrl).toString();
  const imageTags = socialImageTags(siteUrl);
  const storeUrl = escapeAttribute(X_EXTENSION_URL);
  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeAttribute(EXTENSION_TITLE)}</title>`,
    metaTag("name", "description", EXTENSION_DESCRIPTION),
    `<meta http-equiv="refresh" content="0; url=${storeUrl}">`,
    `<link rel="canonical" href="${escapeAttribute(pageUrl)}">`,
    '<link rel="icon" href="/favicon.ico" sizes="any">',
    metaTag("property", "og:type", "website"),
    metaTag("property", "og:site_name", "OpenBot"),
    metaTag("property", "og:locale", "en_US"),
    metaTag("property", "og:url", pageUrl),
    metaTag("property", "og:title", EXTENSION_TITLE),
    metaTag("property", "og:description", EXTENSION_DESCRIPTION),
    ...imageTags.openGraph,
    metaTag("name", "twitter:card", "summary_large_image"),
    metaTag("name", "twitter:site", OPENBOT_X_HANDLE),
    metaTag("name", "twitter:title", EXTENSION_TITLE),
    metaTag("name", "twitter:description", EXTENSION_DESCRIPTION),
    ...imageTags.twitter,
    "</head>",
    '<body style="background:#1a1a1a;color:#f5f5f5;font-family:system-ui,sans-serif">',
    `<p><a href="${storeUrl}" style="color:inherit">${escapeAttribute(EXTENSION_TITLE)}</a></p>`,
    "</body>",
    "</html>",
  ].join("\n");
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
