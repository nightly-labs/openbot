import { cleanup, render, screen, within } from "@solidjs/testing-library";
import type { JSX } from "@solidjs/web";
import { createRootRoute, createRoute, createRouter, isNotFound, RouterContextProvider } from "@tanstack/solid-router";
import { afterEach, describe, expect, it } from "vitest";
import { ArticlePage } from "../src/components/content/ArticlePage";
import { CollectionIndexPage } from "../src/components/content/CollectionIndexPage";
import { LandingPage } from "../src/components/landing/LandingPage";
import { CONTENT_COLLECTIONS } from "../src/lib/content";
import { articlePath, type CollectionArticle, type ContentCollection } from "../src/lib/content-collection";
import { loadGuide } from "../src/routes/guides/$slug";
import { loadNewsArticle } from "../src/routes/news/$slug";

afterEach(cleanup);

/**
 * The routes these pages link to. Not the generated tree: that one also carries the
 * server handlers for the sitemap and the feeds, which import `cloudflare:workers`
 * and cannot load outside a Worker. Nothing is lost by declaring them here, because
 * a component that names a route the real tree does not hold fails the type check.
 */
function createTestRouter() {
  const rootRoute = createRootRoute();
  rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/news" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/news/$slug" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/guides" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/guides/$slug" }),
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

function firstArticle(collection: ContentCollection): CollectionArticle {
  const article = collection.articles[0];
  if (!article) throw new Error(`${collection.name} must hold at least one article.`);
  return article;
}

// Every collection gets the same treatment. A section that is added to the registry
// is held to the index, article and not-found behaviour of the ones before it
// without anyone writing a second copy of these tests.
describe.each(CONTENT_COLLECTIONS.map((collection) => [collection.name, collection] as const))(
  "%s",
  (_name, collection) => {
    it("offers every published article as a link to its page", () => {
      renderPage(() => <CollectionIndexPage collection={collection} />);

      for (const article of collection.articles) {
        const links = screen.getAllByRole("link", { name: (name) => name.includes(article.title) });
        expect(links.map((link) => link.getAttribute("href"))).toContain(articlePath(collection, article.slug));
      }
    });

    it("shows the title, the summary and the prose of every article", () => {
      for (const article of collection.articles) {
        renderPage(() => <ArticlePage collection={collection} article={article} />);

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
      const article = firstArticle(collection);
      renderPage(() => <ArticlePage collection={collection} article={article} />);

      for (const other of collection.articles.filter((entry) => entry.slug !== article.slug)) {
        const links = screen.getAllByRole("link", { name: (name) => name.includes(other.title) });
        expect(links.map((link) => link.getAttribute("href"))).toContain(articlePath(collection, other.slug));
      }
      expect(screen.queryAllByRole("link", { name: (name) => name.includes(article.title) })).toHaveLength(0);
    });
  },
);

describe("landing header", () => {
  it("offers every content section", () => {
    renderPage(() => <LandingPage />);

    // Scoped to the header: the footer links to the same places, and the point of
    // this assertion is the entry points at the top of the page.
    const navigation = within(screen.getByRole("navigation", { name: "Primary navigation" }));
    for (const collection of CONTENT_COLLECTIONS) {
      expect(navigation.getByRole("link", { name: collection.name })).toHaveAttribute("href", collection.indexRoute);
    }
  });
});

// The loaders are per-route rather than shared, so each one is checked. A slug that
// no longer exists must reach the not-found response, not a 200 with an empty page.
describe.each([
  ["news", loadNewsArticle, CONTENT_COLLECTIONS[0]],
  ["guides", loadGuide, CONTENT_COLLECTIONS[1]],
] as const)("%s article route", (_id, load, collection) => {
  it("loads a published article and reports an unknown slug as not found", () => {
    if (!collection) throw new Error("The registry must hold this collection.");
    const article = firstArticle(collection);

    expect(load(article.slug)).toEqual(article);

    let thrown: unknown;
    try {
      load("no-such-article");
    } catch (error) {
      thrown = error;
    }
    expect(isNotFound(thrown)).toBe(true);
  });
});
