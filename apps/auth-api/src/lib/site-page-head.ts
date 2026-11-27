import { SITE_OPEN_GRAPH_LOCALES } from "./site-locale";
import { OPENBOT_X_HANDLE, type PageSocialImage, pageSocialImageMeta } from "./site-metadata";
import { type EnglishPagePath, pagePaths, SITE_LOCALES, type SiteLocale, siteHreflang } from "./site-paths";

export interface SitePageHead {
  page: EnglishPagePath;
  path: string;
  locale: SiteLocale;
  title: string;
  description: string;
  image: PageSocialImage;
}

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
