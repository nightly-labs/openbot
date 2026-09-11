import { cleanup, render, screen, within } from "@solidjs/testing-library";
import type { JSX } from "@solidjs/web";
import { createRootRoute, createRoute, createRouter, isNotFound, RouterContextProvider } from "@tanstack/solid-router";
import { afterEach, describe, expect, it } from "vitest";
import { LandingPage } from "../src/components/landing/LandingPage";
import { NewsArticlePage } from "../src/components/news/NewsArticlePage";
import { NewsIndexPage } from "../src/components/news/NewsIndexPage";
import { NEWS_ARTICLES, newsArticlePath } from "../src/lib/news";
import { loadNewsArticle } from "../src/routes/news/$slug";

afterEach(cleanup);

/**
 * The routes these pages link to. Not the generated tree: that one also carries the
 * server handlers for the sitemap and the feed, which import `cloudflare:workers`
 * and cannot load outside a Worker. Nothing is lost by declaring them here, because
 * a component that names a route the real tree does not hold fails the type check.
 */
function createTestRouter() {
  const rootRoute = createRootRoute();
  rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/news" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/news/$slug" }),
  ]);
  return createRouter({ routeTree: rootRoute });
}

/**
 * Every link inside the site is a router link, and a router link asks the router for
 * its href. Rendering one of these pages on its own leaves that context empty, and
 * the page throws before it draws anything.
 */
function renderPage(page: () => JSX.Element) {
  const router = createTestRouter();
  return render(() => <RouterContextProvider router={router}>{page}</RouterContextProvider>);
}

describe("news index", () => {
  it("offers every published article as a link to its page", () => {
    renderPage(() => <NewsIndexPage />);

    for (const article of NEWS_ARTICLES) {
      const links = screen.getAllByRole("link", { name: (name) => name.includes(article.title) });
      expect(links.map((link) => link.getAttribute("href"))).toContain(newsArticlePath(article.slug));
    }
  });
});

describe("landing header", () => {
  it("offers the news section", () => {
    renderPage(() => <LandingPage />);

    // Scoped to the header: the footer links to the same place, and the point of
    // this assertion is the entry point at the top of the page.
    const navigation = within(screen.getByRole("navigation", { name: "Primary navigation" }));
    expect(navigation.getByRole("link", { name: "News" })).toHaveAttribute("href", "/news");
  });
});

describe("news article page", () => {
  it("shows the article title, its summary and its prose", () => {
    for (const article of NEWS_ARTICLES) {
      renderPage(() => <NewsArticlePage article={article} />);

      expect(screen.getByRole("heading", { level: 1, name: article.title })).toBeInTheDocument();
      expect(screen.getByText(article.description)).toBeInTheDocument();

      // The body is what a reader and a crawler came for, so an article whose body
      // is missing from the registry must not render as a title with nothing under
      // it. Scoped to the article itself: the footer carries headings of its own.
      const body = within(screen.getByRole("article"));
      expect(body.getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(0);

      cleanup();
    }
  });

  it("links on to the other articles", () => {
    const article = NEWS_ARTICLES[0];
    if (!article) throw new Error("The registry must hold at least one article.");
    renderPage(() => <NewsArticlePage article={article} />);

    for (const other of NEWS_ARTICLES.filter((entry) => entry.slug !== article.slug)) {
      const links = screen.getAllByRole("link", { name: (name) => name.includes(other.title) });
      expect(links.map((link) => link.getAttribute("href"))).toContain(newsArticlePath(other.slug));
    }
    expect(screen.queryAllByRole("link", { name: (name) => name.includes(article.title) })).toHaveLength(0);
  });
});

describe("news article route", () => {
  it("loads a published article and reports an unknown slug as not found", () => {
    const article = NEWS_ARTICLES[0];
    if (!article) throw new Error("The registry must hold at least one article.");

    expect(loadNewsArticle(article.slug)).toEqual(article);

    let thrown: unknown;
    try {
      loadNewsArticle("no-such-article");
    } catch (error) {
      thrown = error;
    }
    expect(isNotFound(thrown)).toBe(true);
  });
});
