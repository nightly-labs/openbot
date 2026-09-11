// Head tags for a collection index and its articles. Separate from
// site-metadata.ts to keep the import direction one-way: site-metadata knows
// nothing about articles, content-collection.ts reads the site URL from it, and
// this file is the only thing that reads both.

import {
  articleArtPath,
  articleOgImageUrl,
  articleUrl,
  type CollectionArticle,
  type ContentCollection,
  collectionFeedUrl,
  collectionIndexUrl,
} from "./content-collection";
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

export function collectionIndexHead(collection: ContentCollection) {
  const url = collectionIndexUrl(collection);
  const feed = collectionFeedUrl(collection);

  return {
    meta: [
      { title: collection.indexTitle },
      { name: "description", content: collection.indexDescription },
      { "script:ld+json": collectionStructuredData(collection) },
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

export function articleHead(collection: ContentCollection, article: CollectionArticle) {
  const url = articleUrl(collection, article.slug);
  const image = articleOgImageUrl(collection, article.slug);
  const alt = articleOgImageAlt(article.title);
  const title = `${article.title} — OpenBot`;

  return {
    meta: [
      { title },
      { name: "description", content: article.description },
      { name: "author", content: article.author },
      { "script:ld+json": articleStructuredData(collection, article) },
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
        href: collectionFeedUrl(collection),
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
export function articleStructuredData(collection: ContentCollection, article: CollectionArticle) {
  const url = articleUrl(collection, article.slug);
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.description,
    image: articleOgImageUrl(collection, article.slug),
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

export function collectionStructuredData(collection: ContentCollection) {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: `${collection.name} — ${OPENBOT_SITE_TITLE}`,
    description: collection.indexDescription,
    url: collectionIndexUrl(collection),
    blogPost: collection.articles.map((article) => ({
      "@type": "BlogPosting",
      headline: article.title,
      description: article.description,
      datePublished: `${article.publishedAt}T00:00:00Z`,
      author: { "@type": "Person", name: article.author },
      url: articleUrl(collection, article.slug),
    })),
  };
}
