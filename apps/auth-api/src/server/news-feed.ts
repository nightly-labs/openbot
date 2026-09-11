// The sitemap and the RSS feed, built from the article registry. They live here
// rather than inside the route files so that the tests can assert on the XML
// without standing up a router.

import { NEWS_ARTICLES, newsArticleUrl, newsOgImageUrl, newsRssDate } from "../lib/news";
import { NEWS_FEED_URL, NEWS_INDEX_DESCRIPTION, NEWS_INDEX_URL } from "../lib/news-metadata";
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
function latestPublishedAt(): string {
  return NEWS_ARTICLES[0]?.publishedAt ?? "2026-01-01";
}

export function newsSitemapXml(): string {
  const entries = [
    { loc: OPENBOT_SITE_URL, lastmod: latestPublishedAt(), priority: "1.0" },
    { loc: NEWS_INDEX_URL, lastmod: latestPublishedAt(), priority: "0.8" },
    ...NEWS_ARTICLES.map((article) => ({
      loc: newsArticleUrl(article.slug),
      lastmod: article.updatedAt ?? article.publishedAt,
      priority: "0.7",
    })),
  ];

  const urls = entries
    .map(
      (entry) =>
        `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>\n    <lastmod>${entry.lastmod}</lastmod>\n    <priority>${entry.priority}</priority>\n  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function newsRssXml(): string {
  const items = NEWS_ARTICLES.map((article) => {
    const url = newsArticleUrl(article.slug);
    return [
      "    <item>",
      `      <title>${escapeXml(article.title)}</title>`,
      `      <link>${escapeXml(url)}</link>`,
      // A permanent identity for the item. Readers use it to tell a new article
      // from an edited one, so it must never be the title or the date.
      `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
      `      <description>${escapeXml(article.description)}</description>`,
      `      <pubDate>${newsRssDate(article.publishedAt)}</pubDate>`,
      `      <author>${escapeXml(article.author)}</author>`,
      `      <enclosure url="${escapeXml(newsOgImageUrl(article.slug))}" type="image/png" length="0" />`,
      "    </item>",
    ].join("\n");
  }).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(OPENBOT_SITE_TITLE)}</title>`,
    `    <link>${escapeXml(NEWS_INDEX_URL)}</link>`,
    `    <description>${escapeXml(NEWS_INDEX_DESCRIPTION)}</description>`,
    "    <language>en-us</language>",
    `    <lastBuildDate>${newsRssDate(latestPublishedAt())}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(NEWS_FEED_URL)}" rel="self" type="application/rss+xml" />`,
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

/** One hour at the edge, one day while a redeploy is in flight. */
const FEED_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

export function newsSitemapResponse(): Response {
  return new Response(newsSitemapXml(), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": FEED_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function newsRssResponse(): Response {
  return new Response(newsRssXml(), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": FEED_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
