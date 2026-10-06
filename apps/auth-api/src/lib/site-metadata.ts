// No Vite-only import belongs in this file. `vite.config.ts` reads it, through the
// news artwork generator, while plain Node loads the config, and Node cannot
// resolve an `?url` specifier. That is why the font asset arrives as an argument
// from the root route instead of as an import here.

import { LANDING_FAQ_STRUCTURED_DATA } from "./landing-faq";
import { OPENBOT_ALTERNATE_DOWNLOAD_LINKS, OPENBOT_DOWNLOAD_LINKS } from "./landing-links";

export const OPENBOT_SITE_URL = "https://openbot.run/";
export const OPENBOT_SITE_TITLE = "OpenBot: Run a team of AI agents on your computer";
export const OPENBOT_SITE_DESCRIPTION =
  "A free desktop app that runs AI agents as a team on your own computer, with the ChatGPT, Claude, Gemini or Grok plan you already pay for, or your own model.";
export const OPENBOT_SOCIAL_IMAGE_URL = `${OPENBOT_SITE_URL}openbot-social.png`;
/** The account `OPENBOT_LINKS.contact` opens, which a shared card names. */
export const OPENBOT_X_HANDLE = "@OpenBot_";
const OPENBOT_X_URL = "https://x.com/OpenBot_";
const OPENBOT_REPOSITORY_URL = "https://github.com/nightly-labs/openbot";
const OPENBOT_PRODUCT_HUNT_URL = "https://www.producthunt.com/products/openbot-3";
const OPENBOT_LICENSE_URL = "https://polyformproject.org/licenses/noncommercial/1.0.0/";
// One id for each entity, so that every page describes the same organization,
// site and app, and an assistant can join what the pages say about each.
const OPENBOT_ORGANIZATION_ID = `${OPENBOT_SITE_URL}#organization`;
const OPENBOT_WEBSITE_ID = `${OPENBOT_SITE_URL}#website`;
const OPENBOT_APPLICATION_ID = `${OPENBOT_SITE_URL}#app`;
/** Square, as schema.org wants for a publisher logo. */
export const OPENBOT_LOGO_URL = `${OPENBOT_SITE_URL}icon-512x512.png`;
export const OPENBOT_SOCIAL_IMAGE_ALT = "Meet OpenBot on a dark grid background";

/** The Open Graph tags of the site's own social card, which is 1600x900. */
export const OPENBOT_SOCIAL_IMAGE_META = [
  { property: "og:image", content: OPENBOT_SOCIAL_IMAGE_URL },
  { property: "og:image:type", content: "image/png" },
  { property: "og:image:width", content: "1600" },
  { property: "og:image:height", content: "900" },
  { property: "og:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
] as const;

// The hosts production answers on. Both serve the same pages, and those pages go by
// openbot.run.
const OPENBOT_PRODUCTION_HOSTS = new Set(["openbot.run", "api.openbot.run"]);

/**
 * The site that the head tags of a page served at `pageUrl` name. Social sites fetch
 * `og:url` and `og:image` themselves and show no card when those answer 404. A
 * pull-request preview serves pages and images that openbot.run does not have yet,
 * so any host other than production names itself. Cloudflare marks preview URLs
 * `noindex`, so a preview canonical does not compete with production.
 */
export function siteUrlForPage(pageUrl: URL): string {
  return OPENBOT_PRODUCTION_HOSTS.has(pageUrl.hostname) ? OPENBOT_SITE_URL : `${pageUrl.origin}/`;
}

/** What the app's structured data names and that this file can not import: see the note at the top. */
export interface OpenBotApplicationFacts {
  /** The newest dated release. */
  release: { version: string; date: string } | undefined;
  /** An absolute URL of a picture of the app. */
  screenshot: string;
}

export function openBotSoftwareApplication(facts: OpenBotApplicationFacts) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": OPENBOT_APPLICATION_ID,
    name: "OpenBot",
    url: OPENBOT_SITE_URL,
    image: OPENBOT_SOCIAL_IMAGE_URL,
    description: OPENBOT_SITE_DESCRIPTION,
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "AI agent app",
    operatingSystem: [
      "macOS 13 or later (Apple silicon or Intel)",
      "Windows 10 or later (x64)",
      "Linux (x64 or arm64)",
    ],
    // The installers themselves: schema.org's `downloadUrl` is the file, not a page about it.
    downloadUrl: [
      OPENBOT_DOWNLOAD_LINKS.macos,
      OPENBOT_ALTERNATE_DOWNLOAD_LINKS.macos,
      OPENBOT_DOWNLOAD_LINKS.windows,
      OPENBOT_DOWNLOAD_LINKS.linux,
      OPENBOT_ALTERNATE_DOWNLOAD_LINKS.linux,
    ].map((path) => new URL(path, OPENBOT_SITE_URL).toString()),
    // What people ask an assistant for. Keep it to what the released app does.
    featureList: [
      "Runs Codex, Claude Code, Gemini (Antigravity), Grok and OpenCode agents",
      "Uses your ChatGPT, Claude, Google AI Pro or Ultra, or Grok plan",
      "Any OpenAI-compatible model server, also one on your own computer",
      "Agents that work as a team and keep their workspace and history",
      "Chats, files and workspaces stay on your computer",
      "iPhone and Android apps that connect to your own computer",
      "Free for noncommercial use, with no account needed",
    ],
    isAccessibleForFree: true,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    ...(facts.release ? { softwareVersion: facts.release.version, dateModified: facts.release.date } : {}),
    screenshot: facts.screenshot,
    license: OPENBOT_LICENSE_URL,
    publisher: { "@id": OPENBOT_ORGANIZATION_ID },
    sameAs: [OPENBOT_REPOSITORY_URL, OPENBOT_PRODUCT_HUNT_URL],
  } as const;
}

export type OpenBotSoftwareApplication = ReturnType<typeof openBotSoftwareApplication>;

// Search engines read these two for the site name and the logo next to a result.
const OPENBOT_ORGANIZATION = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": OPENBOT_ORGANIZATION_ID,
  name: "OpenBot",
  url: OPENBOT_SITE_URL,
  logo: OPENBOT_LOGO_URL,
  sameAs: [OPENBOT_REPOSITORY_URL, OPENBOT_X_URL, OPENBOT_PRODUCT_HUNT_URL],
} as const;

const OPENBOT_WEBSITE = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": OPENBOT_WEBSITE_ID,
  name: "OpenBot",
  url: OPENBOT_SITE_URL,
  publisher: { "@id": OPENBOT_ORGANIZATION_ID },
} as const;

export const OPENBOT_SECURITY_HEADERS = {
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
} as const;

/**
 * @param interLatinFont The hashed URL of Inter's upright latin range, the one font
 * file this site downloads. It is reached through two levels of CSS `@import`, so a
 * browser only learns of it after the stylesheet has parsed. That is late enough
 * that the first paint uses a fallback face and every line of text moves when Inter
 * replaces it. The caller passes the same hashed asset the `@font-face` rule asks
 * for, so the preload below is that request and not a second one.
 */
export function openBotRootHead(interLatinFont: string) {
  return {
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: OPENBOT_SITE_TITLE },
      { name: "description", content: OPENBOT_SITE_DESCRIPTION },
      { name: "application-name", content: "OpenBot" },
      { name: "color-scheme", content: "dark" },
      { name: "theme-color", content: "#1a1a1a" },
    ],
    links: [
      {
        rel: "preload",
        as: "font" as const,
        type: "font/woff2",
        href: interLatinFont,
        crossorigin: "anonymous" as const,
      },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", href: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  };
}

export function openBotHomeHead(application: OpenBotSoftwareApplication) {
  return {
    meta: [
      { "script:ld+json": application },
      { "script:ld+json": OPENBOT_ORGANIZATION },
      { "script:ld+json": OPENBOT_WEBSITE },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "OpenBot" },
      { property: "og:locale", content: "en_US" },
      { property: "og:url", content: OPENBOT_SITE_URL },
      { property: "og:title", content: OPENBOT_SITE_TITLE },
      { property: "og:description", content: OPENBOT_SITE_DESCRIPTION },
      ...OPENBOT_SOCIAL_IMAGE_META,
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: OPENBOT_X_HANDLE },
      { name: "twitter:title", content: OPENBOT_SITE_TITLE },
      { name: "twitter:description", content: OPENBOT_SITE_DESCRIPTION },
      { name: "twitter:image", content: OPENBOT_SOCIAL_IMAGE_URL },
      { name: "twitter:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
      { "script:ld+json": LANDING_FAQ_STRUCTURED_DATA },
    ],
    links: [{ rel: "canonical", href: OPENBOT_SITE_URL }],
  };
}
