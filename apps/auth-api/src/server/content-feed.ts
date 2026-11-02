// The sitemap and the per-collection RSS feeds, built from the article
// registries. They live here rather than inside the route files so that the
// tests can assert on the XML without standing up a router.

import {
  createMarketplaceShareUrl,
  isMarketplaceAgentId,
  isMarketplaceSkillSlug,
} from "@openbot/contracts/marketplace-links";
import { BRAND_PAGE_UPDATED_AT, BRAND_ROUTE } from "../lib/brand-page";
import { changelogUrl } from "../lib/changelog";
import { CHANGELOG_UPDATED_AT } from "../lib/changelog-releases";
import { CONTENT_COLLECTIONS } from "../lib/content";
import {
  articleOgImageUrl,
  articleRssDate,
  articleUrl,
  type ContentCollection,
  collectionFeedUrl,
  collectionIndexUrl,
} from "../lib/content-collection";
import { DOWNLOAD_PAGE_ORDER, DOWNLOAD_PAGES_UPDATED_AT, downloadPageUrl } from "../lib/download-pages";
import { MARKETPLACE_APPS_ROUTE, MARKETPLACE_ROUTE, MARKETPLACE_SKILLS_ROUTE } from "../lib/marketplace-routes";
import { PLUGINS_UPDATED_AT, pluginUrl, SITE_PLUGINS } from "../lib/plugins";
import { PRICING_PAGE_UPDATED_AT, PRICING_ROUTE } from "../lib/pricing-page";
import { PRIVACY_POLICY_ROUTE, PRIVACY_POLICY_UPDATED_AT } from "../lib/privacy-policy";
import { OPENBOT_SITE_TITLE, OPENBOT_SITE_URL } from "../lib/site-metadata";
import { TEAMS_PAGE_UPDATED_AT, TEAMS_ROUTE } from "../lib/teams-page";
import { readMarketplaceSitemapListings } from "./marketplace-catalog";

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

/** When an article in the collection last changed: an edit counts, not only a new article. */
function latestModifiedAt(collection: ContentCollection): string {
  return (
    collection.articles
      .map((article) => article.updatedAt ?? article.publishedAt)
      .toSorted()
      .at(-1) ?? "2026-01-01"
  );
}

/** The newest change anywhere on the site, for the home page entry. */
function latestSiteModifiedAt(): string {
  return CONTENT_COLLECTIONS.map(latestModifiedAt).toSorted().at(-1) ?? "2026-01-01";
}

interface SitemapEntry {
  loc: string;
  lastmod: string;
}

/** The newest `updatedAt` of a set of listings, as a date. */
function newestListingDate(listings: readonly { updatedAt: string }[]): string {
  return (
    listings
      .map((listing) => listing.updatedAt.slice(0, 10))
      .toSorted()
      .at(-1) ?? ""
  );
}

/**
 * The Marketplace tabs and every approved agent and skill. An agent that waits for its first review
 * has no approved version, so the catalog never returns it and it is never here.
 */
function marketplaceSitemapEntries(listings: MarketplaceSitemapListings | null): SitemapEntry[] {
  const marketplaceUrl = (path: string) => new URL(path, OPENBOT_SITE_URL).toString();
  const apps = { loc: marketplaceUrl(MARKETPLACE_APPS_ROUTE), lastmod: PLUGINS_UPDATED_AT };
  if (!listings) {
    return [
      { loc: marketplaceUrl(MARKETPLACE_ROUTE), lastmod: "" },
      { loc: marketplaceUrl(MARKETPLACE_SKILLS_ROUTE), lastmod: "" },
      apps,
    ];
  }
  // The link helper throws on an id it cannot address. One bad row must not take the sitemap down.
  const agents = listings.agents.filter((agent) => isMarketplaceAgentId(agent.id));
  const skills = listings.skills.filter((skill) => isMarketplaceSkillSlug(skill.slug));
  return [
    { loc: marketplaceUrl(MARKETPLACE_ROUTE), lastmod: newestListingDate(agents) },
    ...agents.map((agent) => ({
      loc: createMarketplaceShareUrl({ kind: "agent", id: agent.id }),
      lastmod: agent.updatedAt.slice(0, 10),
    })),
    { loc: marketplaceUrl(MARKETPLACE_SKILLS_ROUTE), lastmod: newestListingDate(skills) },
    ...skills.map((skill) => ({
      loc: createMarketplaceShareUrl({ kind: "skill", id: skill.slug }),
      lastmod: skill.updatedAt.slice(0, 10),
    })),
    apps,
  ];
}

function contentSitemapXml(listings: MarketplaceSitemapListings | null): string {
  const entries: SitemapEntry[] = [
    { loc: OPENBOT_SITE_URL, lastmod: latestSiteModifiedAt() },
    { loc: downloadPageUrl("hub"), lastmod: DOWNLOAD_PAGES_UPDATED_AT },
    ...DOWNLOAD_PAGE_ORDER.map((platform) => ({
      loc: downloadPageUrl(platform),
      lastmod: DOWNLOAD_PAGES_UPDATED_AT,
    })),
    ...CONTENT_COLLECTIONS.flatMap((collection) => [
      { loc: collectionIndexUrl(collection), lastmod: latestModifiedAt(collection) },
      ...collection.articles.map((article) => ({
        loc: articleUrl(collection, article.slug),
        lastmod: article.updatedAt ?? article.publishedAt,
      })),
    ]),
    ...marketplaceSitemapEntries(listings),
    /* The plugin pages hold no secret, unlike /join, so they are indexed like any article. Each
       entry's date is the catalog's own, which is what changes when a listing ships. */
    ...SITE_PLUGINS.map((plugin) => ({ loc: pluginUrl(plugin.slug), lastmod: PLUGINS_UPDATED_AT })),
    { loc: changelogUrl(), lastmod: CHANGELOG_UPDATED_AT },
    { loc: new URL(TEAMS_ROUTE, OPENBOT_SITE_URL).toString(), lastmod: TEAMS_PAGE_UPDATED_AT },
    { loc: new URL(PRICING_ROUTE, OPENBOT_SITE_URL).toString(), lastmod: PRICING_PAGE_UPDATED_AT },
    { loc: new URL(BRAND_ROUTE, OPENBOT_SITE_URL).toString(), lastmod: BRAND_PAGE_UPDATED_AT },
    { loc: new URL(PRIVACY_POLICY_ROUTE, OPENBOT_SITE_URL).toString(), lastmod: PRIVACY_POLICY_UPDATED_AT },
  ];

  const urls = entries
    .map(
      (entry) =>
        // An empty <lastmod> is invalid, and the changelog has none until a release is dated.
        `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>\n${entry.lastmod ? `    <lastmod>${entry.lastmod}</lastmod>\n` : ""}  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function contentRssXml(collection: ContentCollection): string {
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
export const FEED_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

type MarketplaceSitemapListings = Awaited<ReturnType<typeof readMarketplaceSitemapListings>>;

/**
 * The sitemap reads the Marketplace from D1. When that read fails, the sitemap still lists every
 * other page and the three tabs, and no cache keeps that shorter version.
 */
export async function contentSitemapResponse(): Promise<Response> {
  const listings = await readMarketplaceSitemapListings().catch(() => null);
  return new Response(contentSitemapXml(listings), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": listings ? FEED_CACHE_CONTROL : "no-store",
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
