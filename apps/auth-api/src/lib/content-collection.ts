// The shape every writing section of the site shares: a list of articles, the
// routes they sit on, and the words that wrap them. /news and /guides are two
// values of this type, so the index page, the article page, the feed, the sitemap
// entries and the baked artwork are written once and read twice.
//
// This module deliberately holds no JSX and imports nothing from solid-js: the
// build-time image generator runs in plain Bun, and pulling a renderer into that
// graph would make the build depend on the UI it is only illustrating. Article
// bodies live in src/content and are wired up separately.

import { OPENBOT_SITE_URL } from "./site-metadata";

export type CollectionId = "news" | "guides";

export interface CollectionArticle {
  /** URL segment. Lowercase, hyphenated, never changed after publication. */
  slug: string;
  title: string;
  /** Meta description and feed summary. Aim for 110-160 characters. */
  description: string;
  /** `YYYY-MM-DD`, treated as UTC. */
  publishedAt: string;
  /** `YYYY-MM-DD`, set only when the body changed meaningfully after publication. */
  updatedAt?: string;
  author: string;
}

export interface ContentCollection {
  id: CollectionId;
  /**
   * The routes, spelled out rather than built from the id. A route the generated
   * tree does not hold is then a type error here, instead of a link that answers
   * 404 once someone clicks it.
   */
  indexRoute: "/news" | "/guides";
  articleRoute: "/news/$slug" | "/guides/$slug";
  /** Navigation label, and the index page's own heading. */
  name: string;
  /** The `<title>` of the index page. */
  indexTitle: string;
  indexDescription: string;
  /** Names the RSS feed, in the feed itself and in `<link rel="alternate">`. */
  feedTitle: string;
  /** The link back to the index from inside an article. */
  backLabel: string;
  /** Heading over the other articles at the foot of an article page. */
  moreTitle: string;
  /** The kicker drawn into the social card. */
  imageEyebrow: string;
  /** Newest first. `publishedFirst` does that once, so no caller has to. */
  articles: readonly CollectionArticle[];
}

/**
 * Newest first, which is the order every consumer wants. Sorting at the registry
 * means editing order in the source file is free.
 */
export function publishedFirst(articles: readonly CollectionArticle[]): readonly CollectionArticle[] {
  return articles.toSorted((left, right) => right.publishedAt.localeCompare(left.publishedAt));
}

export function findArticle(collection: ContentCollection, slug: string): CollectionArticle | undefined {
  return collection.articles.find((article) => article.slug === slug);
}

export function articlePath(collection: ContentCollection, slug: string): string {
  return `${collection.indexRoute}/${slug}`;
}

export function articleUrl(collection: ContentCollection, slug: string): string {
  return new URL(articlePath(collection, slug), OPENBOT_SITE_URL).toString();
}

export function collectionIndexUrl(collection: ContentCollection): string {
  return new URL(collection.indexRoute, OPENBOT_SITE_URL).toString();
}

export function collectionFeedPath(collection: ContentCollection): string {
  return `${collection.indexRoute}/rss.xml`;
}

export function collectionFeedUrl(collection: ContentCollection): string {
  return new URL(collectionFeedPath(collection), OPENBOT_SITE_URL).toString();
}

/** The 1200x630 social card, with the title baked in. Built by `content-images.ts`. */
export function articleOgImageUrl(collection: ContentCollection, slug: string): string {
  return new URL(`/${collection.id}/og/${slug}.png`, OPENBOT_SITE_URL).toString();
}

/**
 * The shapes the artwork is drawn in, one per frame on the site. Each frame gets
 * its own image because the mesh gradient is not scale-invariant: the same
 * description drawn at 2:1 and at 21:9 is a different picture, not a crop of one,
 * so a single image stretched to fit would not be the frame the animation opens on.
 */
export const CONTENT_ART_SHAPES = ["featured", "card", "article"] as const;
export type ContentArtShape = (typeof CONTENT_ART_SHAPES)[number];

/** The artwork behind a card. Gradient only: the title sits over it as real text. */
export function articleArtPath(collection: ContentCollection, slug: string, shape: ContentArtShape): string {
  return `/${collection.id}/art/${shape}/${slug}.png`;
}

// Fixed to UTC on purpose. The Worker renders in UTC and the reader's browser does
// not, so a local-time format makes the server and client disagree on the date near
// midnight and hydration tears the label apart.
const ARTICLE_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatArticleDate(publishedAt: string): string {
  return ARTICLE_DATE_FORMAT.format(new Date(`${publishedAt}T00:00:00Z`));
}

/** RFC 822, which is what RSS 2.0 requires for `pubDate`. */
export function articleRssDate(publishedAt: string): string {
  return new Date(`${publishedAt}T00:00:00Z`).toUTCString();
}
