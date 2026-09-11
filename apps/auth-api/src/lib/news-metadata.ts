// Head tags for /news and its articles. Separate from site-metadata.ts to keep the
// import direction one-way: site-metadata knows nothing about articles, news.ts
// reads the site URL from it, and this file is the only thing that reads both.

import { NEWS_ARTICLES, type NewsArticle, newsArticleUrl, newsCardImagePath, newsOgImageUrl } from "./news";
import {
  OPENBOT_SITE_TITLE,
  OPENBOT_SITE_URL,
  OPENBOT_SOCIAL_IMAGE_ALT,
  OPENBOT_SOCIAL_IMAGE_URL,
} from "./site-metadata";

export const NEWS_INDEX_TITLE = "News — OpenBot";
export const NEWS_INDEX_DESCRIPTION =
  "Notes on building OpenBot: local-first storage, agents that outlive their provider, and how the pieces fit together.";
export const NEWS_INDEX_URL = new URL("/news", OPENBOT_SITE_URL).toString();
export const NEWS_FEED_URL = new URL("/news/rss.xml", OPENBOT_SITE_URL).toString();

/** The generated social cards. Matches what `news-og-images.ts` writes. */
export const NEWS_OG_IMAGE_WIDTH = 1200;
export const NEWS_OG_IMAGE_HEIGHT = 630;

export function newsOgImageAlt(title: string): string {
  return `${title} — OpenBot`;
}

export function openBotNewsIndexHead() {
  return {
    meta: [
      { title: NEWS_INDEX_TITLE },
      { name: "description", content: NEWS_INDEX_DESCRIPTION },
      { "script:ld+json": newsIndexStructuredData() },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "OpenBot" },
      { property: "og:locale", content: "en_US" },
      { property: "og:url", content: NEWS_INDEX_URL },
      { property: "og:title", content: NEWS_INDEX_TITLE },
      { property: "og:description", content: NEWS_INDEX_DESCRIPTION },
      { property: "og:image", content: OPENBOT_SOCIAL_IMAGE_URL },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1600" },
      { property: "og:image:height", content: "900" },
      { property: "og:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: NEWS_INDEX_TITLE },
      { name: "twitter:description", content: NEWS_INDEX_DESCRIPTION },
      { name: "twitter:image", content: OPENBOT_SOCIAL_IMAGE_URL },
      { name: "twitter:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
    ],
    links: [
      { rel: "canonical", href: NEWS_INDEX_URL },
      { rel: "alternate", type: "application/rss+xml", title: "OpenBot news", href: NEWS_FEED_URL },
      ...featuredArtworkPreload(),
    ],
  };
}

/**
 * The artwork of the first article, which fills most of the first screen. It is a
 * background of an element, and no preload scanner reads a background, so without
 * this the browser only learns about the image after the stylesheet has arrived
 * and the first paint is the duller CSS approximation under it.
 */
function featuredArtworkPreload() {
  const featured = NEWS_ARTICLES[0];
  if (!featured) return [];
  return [{ rel: "preload", as: "image" as const, href: newsCardImagePath(featured.slug) }];
}

export function openBotArticleHead(article: NewsArticle) {
  const url = newsArticleUrl(article.slug);
  const image = newsOgImageUrl(article.slug);
  const alt = newsOgImageAlt(article.title);
  const title = `${article.title} — OpenBot`;

  return {
    meta: [
      { title },
      { name: "description", content: article.description },
      { name: "author", content: article.author },
      { "script:ld+json": newsArticleStructuredData(article) },
      { property: "og:type", content: "article" },
      { property: "og:site_name", content: "OpenBot" },
      { property: "og:locale", content: "en_US" },
      { property: "og:url", content: url },
      { property: "og:title", content: title },
      { property: "og:description", content: article.description },
      { property: "og:image", content: image },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: String(NEWS_OG_IMAGE_WIDTH) },
      { property: "og:image:height", content: String(NEWS_OG_IMAGE_HEIGHT) },
      { property: "og:image:alt", content: alt },
      { property: "article:published_time", content: `${article.publishedAt}T00:00:00Z` },
      ...(article.updatedAt ? [{ property: "article:modified_time", content: `${article.updatedAt}T00:00:00Z` }] : []),
      { property: "article:author", content: article.author },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: article.description },
      { name: "twitter:image", content: image },
      { name: "twitter:image:alt", content: alt },
    ],
    links: [
      { rel: "canonical", href: url },
      { rel: "alternate", type: "application/rss+xml", title: "OpenBot news", href: NEWS_FEED_URL },
      // The same reason as on the index: this article's artwork is the first
      // thing under the title and it is a background, not an <img>.
      { rel: "preload", as: "image" as const, href: newsCardImagePath(article.slug) },
    ],
  };
}

// schema.org wants an absolute URL for every entity it can resolve, and a
// `mainEntityOfPage` that matches the canonical. Google drops the date from a
// result when those disagree with each other.
export function newsArticleStructuredData(article: NewsArticle) {
  const url = newsArticleUrl(article.slug);
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.description,
    image: newsOgImageUrl(article.slug),
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

export function newsIndexStructuredData() {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: OPENBOT_SITE_TITLE,
    description: NEWS_INDEX_DESCRIPTION,
    url: NEWS_INDEX_URL,
    blogPost: NEWS_ARTICLES.map((article) => ({
      "@type": "BlogPosting",
      headline: article.title,
      description: article.description,
      datePublished: `${article.publishedAt}T00:00:00Z`,
      author: { "@type": "Person", name: article.author },
      url: newsArticleUrl(article.slug),
    })),
  };
}
