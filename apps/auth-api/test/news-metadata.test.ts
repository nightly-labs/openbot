import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { newsOgJobs } from "../news-og-images";
import { NEWS_ART_SHAPES, NEWS_ARTICLES, newsArticleUrl, newsCardImagePath, newsOgImageUrl } from "../src/lib/news";
import { NEWS_GRADIENT_BRAND_HEXES, newsGradient } from "../src/lib/news-gradient";
import {
  NEWS_FEED_URL,
  NEWS_INDEX_URL,
  type newsArticleStructuredData,
  openBotArticleHead,
} from "../src/lib/news-metadata";
import { OPENBOT_SITE_URL } from "../src/lib/site-metadata";
import { newsRssXml, newsSitemapXml } from "../src/server/news-feed";

type HeadMeta = ReturnType<typeof openBotArticleHead>["meta"][number];

// `flatMap` rather than `find`, because the meta list is a union of shapes and
// only the narrowing inside the callback proves the entry carries a `content`.
function propertyContent(meta: readonly HeadMeta[], property: string): string | undefined {
  return meta.flatMap((item) => ("property" in item && item.property === property ? [item.content] : []))[0];
}

function nameContent(meta: readonly HeadMeta[], name: string): string | undefined {
  return meta.flatMap((item) => ("name" in item && item.name === name ? [item.content] : []))[0];
}

type ArticleStructuredData = ReturnType<typeof newsArticleStructuredData>;

function structuredData(meta: readonly HeadMeta[]): ArticleStructuredData | undefined {
  return meta.flatMap((item) => ("script:ld+json" in item ? [item["script:ld+json"]] : []))[0];
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("article head tags", () => {
  it("points each article at its own page and social card", () => {
    for (const article of NEWS_ARTICLES) {
      const { meta, links } = openBotArticleHead(article);
      const url = newsArticleUrl(article.slug);

      expect(links).toContainEqual({ rel: "canonical", href: url });
      expect(propertyContent(meta, "og:type")).toBe("article");
      expect(propertyContent(meta, "og:url")).toBe(url);
      expect(propertyContent(meta, "og:image")).toBe(newsOgImageUrl(article.slug));
      expect(nameContent(meta, "twitter:image")).toBe(newsOgImageUrl(article.slug));
    }
  });

  it("describes the article to search engines as an Article", () => {
    const article = NEWS_ARTICLES[0];
    if (!article) throw new Error("The registry must hold at least one article.");
    expect(structuredData(openBotArticleHead(article).meta)).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: article.title,
      datePublished: `${article.publishedAt}T00:00:00Z`,
      image: newsOgImageUrl(article.slug),
      author: { "@type": "Person", name: article.author },
      mainEntityOfPage: { "@type": "WebPage", "@id": newsArticleUrl(article.slug) },
    });
  });
});

describe("sitemap", () => {
  it("lists the home page, the index and every article once", () => {
    const xml = newsSitemapXml();

    for (const url of [OPENBOT_SITE_URL, NEWS_INDEX_URL, ...NEWS_ARTICLES.map((a) => newsArticleUrl(a.slug))]) {
      expect(occurrences(xml, `<loc>${url}</loc>`)).toBe(1);
    }
    expect(occurrences(xml, "<loc>")).toBe(NEWS_ARTICLES.length + 2);
  });
});

describe("rss feed", () => {
  it("carries one item per article, linked to its page", () => {
    const xml = newsRssXml();

    expect(occurrences(xml, "<item>")).toBe(NEWS_ARTICLES.length);
    expect(xml).toContain(`href="${NEWS_FEED_URL}"`);
    for (const article of NEWS_ARTICLES) {
      const url = newsArticleUrl(article.slug);
      expect(xml).toContain(`<link>${url}</link>`);
      expect(xml).toContain(`<guid isPermaLink="true">${url}</guid>`);
    }
  });
});

describe("article artwork files", () => {
  it("bakes an image at every path the pages ask for", () => {
    // The pages build these paths and the build writes them from its own list.
    // Nothing else connects the two, and a disagreement is invisible: a missing
    // background falls through to the CSS approximation rather than failing.
    const written = newsOgJobs().map((job) => `/${job.fileName}`);

    for (const article of NEWS_ARTICLES) {
      for (const shape of NEWS_ART_SHAPES) {
        expect(written).toContain(newsCardImagePath(article.slug, shape));
      }
      expect(written).toContain(new URL(newsOgImageUrl(article.slug)).pathname);
    }
  });
});

describe("article artwork", () => {
  it("keeps a published title on the same gradient forever", () => {
    // Pinned on purpose. The social cards already shared point at pixels derived
    // from this, so a change here silently re-colours published articles.
    expect(newsGradient("A fixed title for the gradient test")).toEqual({
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

    for (const [token, hex] of Object.entries(NEWS_GRADIENT_BRAND_HEXES)) {
      expect(tokens).toContain(`${token}: ${hex};`);
    }
  });
});
