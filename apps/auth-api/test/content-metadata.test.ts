import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { contentImageJobs } from "../content-images";
import { ARTICLE_GRADIENT_BRAND_HEXES, articleGradient } from "../src/lib/article-gradient";
import { CONTENT_COLLECTIONS } from "../src/lib/content";
import {
  articleArtPath,
  articleOgImageUrl,
  articleUrl,
  CONTENT_ART_SHAPES,
  type CollectionArticle,
  type ContentCollection,
  collectionFeedUrl,
  collectionIndexUrl,
} from "../src/lib/content-collection";
import { articleHead, type articleStructuredData } from "../src/lib/content-metadata";
import { OPENBOT_SITE_URL } from "../src/lib/site-metadata";
import { contentRssXml, contentSitemapXml } from "../src/server/content-feed";

type HeadMeta = ReturnType<typeof articleHead>["meta"][number];

// `flatMap` rather than `find`, because the meta list is a union of shapes and
// only the narrowing inside the callback proves the entry carries a `content`.
function propertyContent(meta: readonly HeadMeta[], property: string): string | undefined {
  return meta.flatMap((item) => ("property" in item && item.property === property ? [item.content] : []))[0];
}

function nameContent(meta: readonly HeadMeta[], name: string): string | undefined {
  return meta.flatMap((item) => ("name" in item && item.name === name ? [item.content] : []))[0];
}

type ArticleStructuredData = ReturnType<typeof articleStructuredData>;

function structuredData(meta: readonly HeadMeta[]): ArticleStructuredData | undefined {
  return meta.flatMap((item) => ("script:ld+json" in item ? [item["script:ld+json"]] : []))[0];
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function firstArticle(collection: ContentCollection): CollectionArticle {
  const article = collection.articles[0];
  if (!article) throw new Error(`${collection.name} must hold at least one article.`);
  return article;
}

const COLLECTION_CASES = CONTENT_COLLECTIONS.map((collection) => [collection.name, collection] as const);
const ALL_ARTICLES = CONTENT_COLLECTIONS.flatMap((collection) => collection.articles);

const PREVIEW_SITE_URL = "https://pr-451-openbot-landing-preview.example.workers.dev/";

describe.each(COLLECTION_CASES)("%s head tags", (_name, collection) => {
  it("points each article at its own page and social card", () => {
    for (const article of collection.articles) {
      const { meta, links } = articleHead(collection, article, OPENBOT_SITE_URL);
      const url = articleUrl(collection, article.slug);

      expect(links).toContainEqual({ rel: "canonical", href: url });
      expect(propertyContent(meta, "og:type")).toBe("article");
      expect(propertyContent(meta, "og:url")).toBe(url);
      expect(propertyContent(meta, "og:image")).toBe(articleOgImageUrl(collection, article.slug));
      expect(nameContent(meta, "twitter:image")).toBe(articleOgImageUrl(collection, article.slug));
    }
  });

  it("points a preview's social card at the preview, where the card exists", () => {
    // A social site fetches og:url and og:image itself. Pointed at production, a
    // preview of a new article shows no card, because production does not have it.
    const article = firstArticle(collection);
    const { meta, links } = articleHead(collection, article, PREVIEW_SITE_URL);
    const url = `${PREVIEW_SITE_URL}${collection.id}/${article.slug}`;
    const image = `${PREVIEW_SITE_URL}${collection.id}/og/${article.slug}.png`;

    expect(links).toContainEqual({ rel: "canonical", href: url });
    expect(propertyContent(meta, "og:url")).toBe(url);
    expect(propertyContent(meta, "og:image")).toBe(image);
    expect(nameContent(meta, "twitter:image")).toBe(image);
    expect(structuredData(meta)).toMatchObject({ image, mainEntityOfPage: { "@id": url } });
  });

  it("names the section the article belongs to", () => {
    const article = firstArticle(collection);
    expect(propertyContent(articleHead(collection, article, OPENBOT_SITE_URL).meta, "article:section")).toBe(
      collection.name,
    );
  });

  it("describes the article to search engines as an Article", () => {
    const article = firstArticle(collection);
    expect(structuredData(articleHead(collection, article, OPENBOT_SITE_URL).meta)).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: article.title,
      datePublished: `${article.publishedAt}T00:00:00Z`,
      image: articleOgImageUrl(collection, article.slug),
      author: { "@type": "Person", name: article.author },
      mainEntityOfPage: { "@type": "WebPage", "@id": articleUrl(collection, article.slug) },
    });
  });
});

describe("sitemap", () => {
  it("lists the home page, every index and every article once", () => {
    const xml = contentSitemapXml();
    const urls = [
      OPENBOT_SITE_URL,
      ...CONTENT_COLLECTIONS.flatMap((collection) => [
        collectionIndexUrl(collection),
        ...collection.articles.map((article) => articleUrl(collection, article.slug)),
      ]),
    ];

    for (const url of urls) {
      expect(occurrences(xml, `<loc>${url}</loc>`)).toBe(1);
    }
    expect(occurrences(xml, "<loc>")).toBe(urls.length);
  });
});

describe.each(COLLECTION_CASES)("%s rss feed", (_name, collection) => {
  it("carries one item per article, linked to its page", () => {
    const xml = contentRssXml(collection);

    expect(occurrences(xml, "<item>")).toBe(collection.articles.length);
    expect(xml).toContain(`href="${collectionFeedUrl(collection)}"`);
    for (const article of collection.articles) {
      const url = articleUrl(collection, article.slug);
      expect(xml).toContain(`<link>${url}</link>`);
      expect(xml).toContain(`<guid isPermaLink="true">${url}</guid>`);
    }
  });

  it("holds only its own articles", () => {
    const xml = contentRssXml(collection);

    for (const other of CONTENT_COLLECTIONS.filter((entry) => entry.id !== collection.id)) {
      for (const article of other.articles) {
        expect(xml).not.toContain(articleUrl(other, article.slug));
      }
    }
  });
});

describe("article artwork files", () => {
  it("bakes an image at every path the pages ask for", () => {
    // The pages build these paths and the build writes them from its own list.
    // Nothing else connects the two, and a disagreement is invisible: a missing
    // background falls through to the CSS approximation rather than failing.
    const written = contentImageJobs().map((job) => `/${job.fileName}`);

    for (const collection of CONTENT_COLLECTIONS) {
      for (const article of collection.articles) {
        for (const shape of CONTENT_ART_SHAPES) {
          expect(written).toContain(articleArtPath(collection, article.slug, shape));
        }
        expect(written).toContain(new URL(articleOgImageUrl(collection, article.slug)).pathname);
      }
    }
  });

  it("draws the section the card belongs to on its social card", () => {
    // One shared generator draws every card, so the kicker has to travel with the
    // job. Without it a guide ships a card that says it is news.
    for (const collection of CONTENT_COLLECTIONS) {
      const slugs = new Set(collection.articles.map((article) => article.slug));
      const jobs = contentImageJobs().filter((job) => job.fileName.startsWith(`${collection.id}/`));

      expect(jobs.length).toBeGreaterThan(0);
      for (const job of jobs) {
        expect(slugs).toContain(job.slug);
        expect(job.eyebrow).toBe(collection.imageEyebrow);
      }
    }
  });
});

describe("article slugs", () => {
  it("never reuses a slug across the whole site", () => {
    // The artwork files and the social cards are keyed by slug, so two articles that
    // share one overwrite each other's artwork whichever section they sit in.
    const slugs = ALL_ARTICLES.map((article) => article.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("article artwork", () => {
  it("keeps a published title on the same gradient forever", () => {
    // Pinned on purpose. The social cards already shared point at pixels derived
    // from this, so a change here silently re-colours published articles.
    expect(articleGradient("A fixed title for the gradient test")).toEqual({
      colors: ["#d6adf2", "#7b3fa8", "#6f7de8", "#007cf7", "#1a1a1a"],
      distortion: 0.74,
      swirl: 0.1,
      grainMixer: 0.17,
      rotation: 298,
      frame: 35683,
    });
  });

  it("uses the brand colours the rest of the site uses", async () => {
    const tokens = await readFile(new URL("../../../packages/brand/src/tokens.css", import.meta.url), "utf8");

    for (const [token, hex] of Object.entries(ARTICLE_GRADIENT_BRAND_HEXES)) {
      expect(tokens).toContain(`${token}: ${hex};`);
    }
  });
});
