import { OPENBOT_SITE_URL, type PageSocialImage } from "./site-metadata";

export type CollectionId = "news" | "guides" | "compare" | "providers";
export type ProseCollectionId = Exclude<CollectionId, "compare" | "providers">;

export interface CollectionArticle {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt?: string;
  author: string;
}

export interface ContentCollection<Id extends CollectionId = CollectionId> {
  id: Id;
  indexRoute: `/${Id}`;
  articleRoute: `/${Id}/$slug`;
  name: string;
  indexTitle: string;
  indexDescription: string;
  indexSocialImage?: PageSocialImage;
  feedTitle: string;
  backLabel: string;
  moreTitle: string;
  imageEyebrow: string;
  articles: readonly CollectionArticle[];
}

export function publishedFirst(articles: readonly CollectionArticle[]): readonly CollectionArticle[] {
  return articles.toSorted((left, right) => right.publishedAt.localeCompare(left.publishedAt));
}

export function findArticle(collection: ContentCollection, slug: string): CollectionArticle | undefined {
  return collection.articles.find((article) => article.slug === slug);
}

export function articlePath(collection: ContentCollection, slug: string): string {
  return `${collection.indexRoute}/${slug}`;
}

export function reportedArticlePath(collection: ContentCollection, slug: string): string {
  return findArticle(collection, slug) ? articlePath(collection, slug) : collection.indexRoute;
}

export function articleUrl(collection: ContentCollection, slug: string, siteUrl = OPENBOT_SITE_URL): string {
  return new URL(articlePath(collection, slug), siteUrl).toString();
}

export function articleMarkdownUrl(collection: ContentCollection, slug: string, siteUrl = OPENBOT_SITE_URL): string {
  return new URL(`${articlePath(collection, slug)}.md`, siteUrl).toString();
}

export function collectionIndexUrl(collection: ContentCollection, siteUrl = OPENBOT_SITE_URL): string {
  return new URL(collection.indexRoute, siteUrl).toString();
}

function collectionFeedPath(collection: ContentCollection): string {
  return `${collection.indexRoute}/rss.xml`;
}

export function collectionFeedUrl(collection: ContentCollection, siteUrl = OPENBOT_SITE_URL): string {
  return new URL(collectionFeedPath(collection), siteUrl).toString();
}

export function articleOgImageUrl(collection: ContentCollection, slug: string, siteUrl = OPENBOT_SITE_URL): string {
  return new URL(`/${collection.id}/og/${slug}.png`, siteUrl).toString();
}

export const CONTENT_ART_SHAPES = ["featured", "card", "article"] as const;
export type ContentArtShape = (typeof CONTENT_ART_SHAPES)[number];

export function articleArtPath(collection: ContentCollection, slug: string, shape: ContentArtShape): string {
  return `/${collection.id}/art/${shape}/${slug}.webp`;
}

const ARTICLE_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatArticleDate(publishedAt: string): string {
  return ARTICLE_DATE_FORMAT.format(new Date(`${publishedAt}T00:00:00Z`));
}

export function articleRssDate(publishedAt: string): string {
  return new Date(`${publishedAt}T00:00:00Z`).toUTCString();
}
