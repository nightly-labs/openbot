// Head tags for a collection index and its articles. Separate from
// site-metadata.ts to keep the import direction one-way: site-metadata knows
// nothing about articles, content-collection.ts reads the site URL from it, and
// this file is the only thing that reads both.
//
// Each function takes `siteUrl`, the site that served the page. It is required, so
// that no route can forget it and send a preview's social card to production.

import {
  articleArtPath,
  articleOgImageUrl,
  articleUrl,
  type CollectionArticle,
  type ContentCollection,
  collectionFeedUrl,
  collectionIndexUrl,
} from "./content-collection";
import { PLUGINS_DESCRIPTION, PLUGINS_TITLE, pluginIndexUrl, pluginUrl, type SitePlugin } from "./plugins";
import {
  OPENBOT_SITE_TITLE,
  OPENBOT_SITE_URL,
  OPENBOT_SOCIAL_IMAGE_ALT,
  OPENBOT_SOCIAL_IMAGE_URL,
} from "./site-metadata";

/** The generated social cards. Matches what `content-images.ts` writes. */
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

export function articleOgImageAlt(title: string): string {
  return `${title} — OpenBot`;
}

export function collectionIndexHead(collection: ContentCollection, siteUrl: string) {
  const url = collectionIndexUrl(collection, siteUrl);
  const feed = collectionFeedUrl(collection, siteUrl);

  return {
    meta: [
      { title: collection.indexTitle },
      { name: "description", content: collection.indexDescription },
      { "script:ld+json": collectionStructuredData(collection, siteUrl) },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "OpenBot" },
      { property: "og:locale", content: "en_US" },
      { property: "og:url", content: url },
      { property: "og:title", content: collection.indexTitle },
      { property: "og:description", content: collection.indexDescription },
      { property: "og:image", content: OPENBOT_SOCIAL_IMAGE_URL },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1600" },
      { property: "og:image:height", content: "900" },
      { property: "og:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: collection.indexTitle },
      { name: "twitter:description", content: collection.indexDescription },
      { name: "twitter:image", content: OPENBOT_SOCIAL_IMAGE_URL },
      { name: "twitter:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
    ],
    links: [
      { rel: "canonical", href: url },
      { rel: "alternate", type: "application/rss+xml", title: collection.feedTitle, href: feed },
      ...featuredArtworkPreload(collection),
    ],
  };
}

/**
 * The artwork of the first article, which fills most of the first screen. It is a
 * background of an element, and no preload scanner reads a background, so without
 * this the browser only learns about the image after the stylesheet has arrived
 * and the first paint is the duller CSS approximation under it.
 */
function featuredArtworkPreload(collection: ContentCollection) {
  const featured = collection.articles[0];
  if (!featured) return [];
  return [{ rel: "preload", as: "image" as const, href: articleArtPath(collection, featured.slug, "featured") }];
}

export function articleHead(collection: ContentCollection, article: CollectionArticle, siteUrl: string) {
  const url = articleUrl(collection, article.slug, siteUrl);
  const image = articleOgImageUrl(collection, article.slug, siteUrl);
  const alt = articleOgImageAlt(article.title);
  const title = `${article.title} — OpenBot`;

  return {
    meta: [
      { title },
      { name: "description", content: article.description },
      { name: "author", content: article.author },
      { "script:ld+json": articleStructuredData(collection, article, siteUrl) },
      { property: "og:type", content: "article" },
      { property: "og:site_name", content: "OpenBot" },
      { property: "og:locale", content: "en_US" },
      { property: "og:url", content: url },
      { property: "og:title", content: title },
      { property: "og:description", content: article.description },
      { property: "og:image", content: image },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: String(OG_IMAGE_WIDTH) },
      { property: "og:image:height", content: String(OG_IMAGE_HEIGHT) },
      { property: "og:image:alt", content: alt },
      { property: "article:published_time", content: `${article.publishedAt}T00:00:00Z` },
      ...(article.updatedAt ? [{ property: "article:modified_time", content: `${article.updatedAt}T00:00:00Z` }] : []),
      { property: "article:author", content: article.author },
      { property: "article:section", content: collection.name },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: article.description },
      { name: "twitter:image", content: image },
      { name: "twitter:image:alt", content: alt },
    ],
    links: [
      { rel: "canonical", href: url },
      {
        rel: "alternate",
        type: "application/rss+xml",
        title: collection.feedTitle,
        href: collectionFeedUrl(collection, siteUrl),
      },
      // The same reason as on the index: this article's artwork is the first
      // thing under the title and it is a background, not an <img>.
      { rel: "preload", as: "image" as const, href: articleArtPath(collection, article.slug, "article") },
    ],
  };
}

// schema.org wants an absolute URL for every entity it can resolve, and a
// `mainEntityOfPage` that matches the canonical. Google drops the date from a
// result when those disagree with each other.
export function articleStructuredData(collection: ContentCollection, article: CollectionArticle, siteUrl: string) {
  const url = articleUrl(collection, article.slug, siteUrl);
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.description,
    image: articleOgImageUrl(collection, article.slug, siteUrl),
    datePublished: `${article.publishedAt}T00:00:00Z`,
    dateModified: `${article.updatedAt ?? article.publishedAt}T00:00:00Z`,
    author: { "@type": "Person", name: article.author },
    publisher: {
      "@type": "Organization",
      name: "OpenBot",
      url: OPENBOT_SITE_URL,
      logo: { "@type": "ImageObject", url: OPENBOT_SOCIAL_IMAGE_URL },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    isAccessibleForFree: true,
    url,
  };
}

export function collectionStructuredData(collection: ContentCollection, siteUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: `${collection.name} — ${OPENBOT_SITE_TITLE}`,
    description: collection.indexDescription,
    url: collectionIndexUrl(collection, siteUrl),
    blogPost: collection.articles.map((article) => ({
      "@type": "BlogPosting",
      headline: article.title,
      description: article.description,
      datePublished: `${article.publishedAt}T00:00:00Z`,
      author: { "@type": "Person", name: article.author },
      url: articleUrl(collection, article.slug, siteUrl),
    })),
  };
}

/**
 * The plugin pages. They carry the site's own social card rather than a generated one: the artwork
 * pipeline in `content-images.ts` draws articles, and a listing is not an article. The structured
 * data is `SoftwareApplication`, which is what a plugin is.
 */
export function pluginsIndexHead(siteUrl: string) {
  const url = pluginIndexUrl(siteUrl);

  return {
    meta: [
      { title: PLUGINS_TITLE },
      { name: "description", content: PLUGINS_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "OpenBot" },
      { property: "og:locale", content: "en_US" },
      { property: "og:url", content: url },
      { property: "og:title", content: PLUGINS_TITLE },
      { property: "og:description", content: PLUGINS_DESCRIPTION },
      { property: "og:image", content: OPENBOT_SOCIAL_IMAGE_URL },
      { property: "og:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: PLUGINS_TITLE },
      { name: "twitter:description", content: PLUGINS_DESCRIPTION },
      { name: "twitter:image", content: OPENBOT_SOCIAL_IMAGE_URL },
      { name: "twitter:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

export function pluginHead(plugin: SitePlugin, siteUrl: string) {
  const url = pluginUrl(plugin.slug, siteUrl);
  const title = `${plugin.name} — OpenBot plugins`;

  return {
    meta: [
      { title },
      { name: "description", content: plugin.tagline },
      { "script:ld+json": pluginStructuredData(plugin, siteUrl) },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "OpenBot" },
      { property: "og:locale", content: "en_US" },
      { property: "og:url", content: url },
      { property: "og:title", content: title },
      { property: "og:description", content: plugin.tagline },
      { property: "og:image", content: OPENBOT_SOCIAL_IMAGE_URL },
      { property: "og:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: plugin.tagline },
      { name: "twitter:image", content: OPENBOT_SOCIAL_IMAGE_URL },
      { name: "twitter:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

/**
 * The listing as schema.org sees it. `softwareVersion` is the developer's own string, and the
 * offer says free because installing a plugin costs nothing; what the developer's own service
 * charges is between the reader and the developer, so nothing here claims otherwise.
 */
export function pluginStructuredData(plugin: SitePlugin, siteUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: plugin.name,
    description: plugin.description,
    applicationCategory: "DeveloperApplication",
    softwareVersion: plugin.version,
    author: { "@type": "Organization", name: plugin.creatorName },
    isPartOf: { "@type": "SoftwareApplication", name: "OpenBot", url: OPENBOT_SITE_URL },
    mainEntityOfPage: { "@type": "WebPage", "@id": pluginUrl(plugin.slug, siteUrl) },
    url: pluginUrl(plugin.slug, siteUrl),
  };
}
