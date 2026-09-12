// The sitemap and the per-collection RSS feeds, built from the article
// registries. They live here rather than inside the route files so that the
// tests can assert on the XML without standing up a router.

import { CONTENT_COLLECTIONS } from "../lib/content";
import {
  articleOgImageUrl,
  articleRssDate,
  articleUrl,
  type ContentCollection,
  collectionFeedUrl,
  collectionIndexUrl,
} from "../lib/content-collection";
import { OPENBOT_SITE_TITLE, OPENBOT_SITE_URL } from "../lib/site-metadata";

/**
 * The five characters XML reserves. `>` is only special after `]]`, but escaping
 * it as well keeps the rule one line long and costs nothing.
 */
function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** The date of the newest article. Fixed input, so the feed stays cacheable. */
function latestPublishedAt(collection: ContentCollection): string {
  return collection.articles[0]?.publishedAt ?? "2026-01-01";
}

/** The newest date anywhere on the site, for the home page entry. */
function latestSitePublishedAt(): string {
  return CONTENT_COLLECTIONS.map(latestPublishedAt).toSorted().at(-1) ?? "2026-01-01";
}

export function contentSitemapXml(): string {
  const entries = [
    { loc: OPENBOT_SITE_URL, lastmod: latestSitePublishedAt(), priority: "1.0" },
    ...CONTENT_COLLECTIONS.flatMap((collection) => [
      { loc: collectionIndexUrl(collection), lastmod: latestPublishedAt(collection), priority: "0.8" },
      ...collection.articles.map((article) => ({
        loc: articleUrl(collection, article.slug),
        lastmod: article.updatedAt ?? article.publishedAt,
        priority: "0.7",
      })),
    ]),
  ];

  const urls = entries
    .map(
      (entry) =>
        `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>\n    <lastmod>${entry.lastmod}</lastmod>\n    <priority>${entry.priority}</priority>\n  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function contentRssXml(collection: ContentCollection): string {
  const items = collection.articles
    .map((article) => {
      const url = articleUrl(collection, article.slug);
      return [
        "    <item>",
        `      <title>${escapeXml(article.title)}</title>`,
        `      <link>${escapeXml(url)}</link>`,
        // A permanent identity for the item. Readers use it to tell a new article
        // from an edited one, so it must never be the title or the date.
        `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
        `      <description>${escapeXml(article.description)}</description>`,
        `      <pubDate>${articleRssDate(article.publishedAt)}</pubDate>`,
        // RSS 2.0 `<author>` holds an email address, and a name there makes the
        // item invalid. Dublin Core's creator is the field for a name.
        `      <dc:creator>${escapeXml(article.author)}</dc:creator>`,
        `      <enclosure url="${escapeXml(articleOgImageUrl(collection, article.slug))}" type="image/png" length="0" />`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "  <channel>",
    `    <title>${escapeXml(`${collection.feedTitle} — ${OPENBOT_SITE_TITLE}`)}</title>`,
    `    <link>${escapeXml(collectionIndexUrl(collection))}</link>`,
    `    <description>${escapeXml(collection.indexDescription)}</description>`,
    "    <language>en-us</language>",
    `    <lastBuildDate>${articleRssDate(latestPublishedAt(collection))}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(collectionFeedUrl(collection))}" rel="self" type="application/rss+xml" />`,
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

/** One hour at the edge, one day while a redeploy is in flight. */
const FEED_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

export function contentSitemapResponse(): Response {
  return new Response(contentSitemapXml(), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": FEED_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function contentRssResponse(collection: ContentCollection): Response {
  return new Response(contentRssXml(collection), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": FEED_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
