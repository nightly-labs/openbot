import { SITE_OPEN_GRAPH_LOCALES } from "./site-locale";
import { OPENBOT_X_HANDLE, type PageSocialImage, pageSocialImageMeta } from "./site-metadata";
import { type EnglishPagePath, pagePaths, SITE_LOCALES, type SiteLocale, siteHreflang } from "./site-paths";

/** The head of a page that has localized copies, in one language. */
export interface SitePageHead {
  /** The English address of the page. */
  page: EnglishPagePath;
  /** The address of this route: the English address, or a localized one. */
  path: string;
  locale: SiteLocale;
  title: string;
  description: string;
  image: PageSocialImage;
}

/**
 * The head tags of a page with localized copies. The English address shows the language of the
 * request, so its canonical address stays the English address. The `hreflang` links name the English
 * address for English and as `x-default`, and the localized address for each other language.
 */
export function sitePageHead(siteUrl: string, head: SitePageHead) {
  const url = new URL(head.path, siteUrl).toString();
  const image = pageSocialImageMeta(head.image, siteUrl);
  const paths = pagePaths(head.page);
  return {
    meta: [
      { title: head.title },
      { name: "description", content: head.description },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "OpenBot" },
      { property: "og:locale", content: SITE_OPEN_GRAPH_LOCALES[head.locale] },
      { property: "og:url", content: url },
      { property: "og:title", content: head.title },
      { property: "og:description", content: head.description },
      ...image.openGraph,
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: OPENBOT_X_HANDLE },
      { name: "twitter:title", content: head.title },
      { name: "twitter:description", content: head.description },
      ...image.twitter,
    ],
    links: [
      { rel: "canonical", href: url },
      ...SITE_LOCALES.map((locale) => ({
        rel: "alternate",
        hreflang: siteHreflang(locale),
        href: new URL(paths[locale], siteUrl).toString(),
      })),
      { rel: "alternate", hreflang: "x-default", href: new URL(paths.en, siteUrl).toString() },
    ],
  };
}
