import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import type { JSX } from "@solidjs/web";
import { createRootRoute, createRoute, createRouter, isNotFound, RouterContextProvider } from "@tanstack/solid-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArticleGradient } from "../src/components/content/ArticleGradient";
import { ArticleClip, ArticleGif } from "../src/components/content/ArticleMedia";
import { ArticlePage } from "../src/components/content/ArticlePage";
import { CollectionIndexPage } from "../src/components/content/CollectionIndexPage";
import { LandingPage } from "../src/components/landing/LandingPage";
import { articleGradient } from "../src/lib/article-gradient";
import { CONTENT_COLLECTIONS } from "../src/lib/content";
import { articlePath, type CollectionArticle, type ContentCollection } from "../src/lib/content-collection";
import { loadGuide } from "../src/routes/guides/$slug";
import { loadNewsArticle } from "../src/routes/news/$slug";

// The frame each shader opened on, in order. A card loads the shader library with
// a dynamic import, to keep it out of the first bundle, so there is no seam to hand
// it a fake. This wraps the real mount instead: it notes the frame, then builds the
// mount as usual. The frame comes from the article title, so it names the card.
const shaderOpeningFrames = vi.hoisted((): (number | undefined)[] => []);
vi.mock(import("@paper-design/shaders"), async (importOriginal) => {
  const shaders = await importOriginal();
  class RecordingShaderMount extends shaders.ShaderMount {
    constructor(...args: ConstructorParameters<typeof shaders.ShaderMount>) {
      shaderOpeningFrames.push(args[5]);
      super(...args);
    }
  }
  return { ...shaders, ShaderMount: RecordingShaderMount };
});

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

/**
 * The reader's motion setting. Every other query answers no, which is also how a
 * touch screen answers the hover query. Returns the queries asked, in order.
 */
function stubMotionPreference(reduced: boolean): string[] {
  const asked: string[] = [];
  vi.stubGlobal("matchMedia", (query: string) => {
    asked.push(query);
    return {
      matches: reduced && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
  });
  return asked;
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

// Anything in an article that moves starts from the reader's setting and can be
// stopped by hand. Neither part is in the markup a body writes — the body only
// names a file — so both are checked here, on the two components that move.
describe("article media", () => {
  const GIF = { src: "/loop.gif", still: "/loop-still.webp", alt: "An agent answers a question" };
  const CLIP = { src: "/clip.mp4", poster: "/clip-poster.webp", label: "An icon dragged into a folder" };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // A clip plays only where it can be seen, so nothing at all happens until an
  // observer reports it on screen. This one reports that as soon as it is asked;
  // the returned `scrollAway` and `scrollBack` report it for everything observed.
  function stubOnScreen() {
    const watchers = new Set<{
      report: IntersectionObserverCallback;
      targets: Set<Element>;
      self: IntersectionObserver;
    }>();

    class OnScreenObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly scrollMargin = "0px";
      readonly thresholds: readonly number[] = [0];
      private readonly report: IntersectionObserverCallback;
      private readonly targets = new Set<Element>();

      constructor(callback: IntersectionObserverCallback) {
        this.report = callback;
        watchers.add({ report: callback, targets: this.targets, self: this });
      }

      observe(target: Element) {
        this.targets.add(target);
        this.report([entry(target, true)], this);
      }

      unobserve(target: Element) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
      }
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }

    function entry(target: Element, isIntersecting: boolean): IntersectionObserverEntry {
      const rect = new DOMRectReadOnly(0, 0, 100, 100);
      return {
        boundingClientRect: rect,
        intersectionRatio: isIntersecting ? 1 : 0,
        intersectionRect: rect,
        isIntersecting,
        rootBounds: rect,
        target,
        time: 0,
      };
    }

    vi.stubGlobal("IntersectionObserver", OnScreenObserver);

    function reportAll(isIntersecting: boolean) {
      for (const watcher of watchers) {
        for (const target of watcher.targets) watcher.report([entry(target, isIntersecting)], watcher.self);
      }
    }

    return {
      scrollAway: () => reportAll(false),
      scrollBack: () => reportAll(true),
    };
  }

  /** The clip the browser was asked to play, which is the point of the test. */
  function spyOnPlay() {
    let played: HTMLMediaElement | undefined;
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      played = this;
      return Promise.resolve();
    });
    return { play, playedMedia: () => played };
  }

  /** The clip the browser was asked to stop. `onPause` runs as the pause does. */
  function spyOnPause(onPause: () => void = () => {}) {
    let paused: HTMLMediaElement | undefined;
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
      paused = this;
      onPause();
    });
    // jsdom never really plays anything, so the clip would report itself as
    // already stopped and there would be nothing to stop.
    vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(false);
    return { pause, pausedMedia: () => paused };
  }

  function renderGif() {
    return render(() => <ArticleGif src={GIF.src} still={GIF.still} alt={GIF.alt} width={800} height={500} />);
  }

  function renderClip() {
    return render(() => (
      <ArticleClip src={CLIP.src} poster={CLIP.poster} label={CLIP.label} width={1280} height={720} />
    ));
  }

  it("stops an animated image when the reader asks for it to stop", async () => {
    stubMotionPreference(false);
    renderGif();

    await waitFor(() => expect(screen.getByRole("button", { name: "Pause animation" })).toBeInTheDocument());
    expect(screen.getByRole("img", { name: GIF.alt })).toHaveAttribute("src", GIF.src);

    await fireEvent.click(screen.getByRole("button", { name: "Pause animation" }));

    // The still is a second file, because a GIF cannot be stopped where it stands.
    expect(screen.getByRole("img", { name: GIF.alt })).toHaveAttribute("src", GIF.still);
    expect(screen.getByRole("button", { name: "Play animation" })).toBeInTheDocument();
  });

  it("leaves an animated image at rest for a reader who asked for less motion", async () => {
    stubMotionPreference(true);
    renderGif();

    await waitFor(() => expect(screen.getByRole("button", { name: "Play animation" })).toBeInTheDocument());
    expect(screen.getByRole("img", { name: GIF.alt })).toHaveAttribute("src", GIF.still);
  });

  it("plays the clip it was given once it is on screen", async () => {
    stubMotionPreference(false);
    stubOnScreen();
    const { play, playedMedia } = spyOnPlay();

    renderClip();

    await waitFor(() => expect(play).toHaveBeenCalled());
    // Which clip started matters as much as that one did: a figure with no
    // source of its own would otherwise pass this test.
    expect(playedMedia()).toHaveAttribute("src", CLIP.src);
    expect(screen.getByRole("img", { name: CLIP.label })).toBeInTheDocument();
  });

  it("stops a clip that has been scrolled away from", async () => {
    stubMotionPreference(false);
    const viewport = stubOnScreen();
    const { play, playedMedia } = spyOnPlay();
    const { pause, pausedMedia } = spyOnPause();

    renderClip();
    await waitFor(() => expect(play).toHaveBeenCalled());

    viewport.scrollAway();

    await waitFor(() => expect(pause).toHaveBeenCalled());
    // The clip that stops has to be the one that started, not any video at all.
    expect(pausedMedia()).toHaveAttribute("src", CLIP.src);
    expect(pausedMedia()).toBe(playedMedia());
  });

  it("starts a clip again when a start cut short by scrolling away comes back on screen", async () => {
    stubMotionPreference(false);
    const viewport = stubOnScreen();
    // A start that is still pending, which a pause cancels the way a browser does.
    const starts: Promise<void>[] = [];
    let cancelStart = () => {};
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => {
      const start = new Promise<void>((_, reject) => {
        cancelStart = () => reject(new DOMException("The play() request was interrupted by pause().", "AbortError"));
      });
      starts.push(start);
      return start;
    });
    spyOnPause(() => cancelStart());

    renderClip();
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));

    viewport.scrollAway();
    // The clip handles the cancelled start before this wait ends.
    await starts[0]?.catch(() => {});
    viewport.scrollBack();

    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Pause animation" })).toBeInTheDocument();
  });

  it("does not start a clip for a reader who asked for less motion", async () => {
    stubMotionPreference(true);
    stubOnScreen();
    const { play } = spyOnPlay();

    renderClip();

    await waitFor(() => expect(screen.getByRole("button", { name: "Play animation" })).toBeInTheDocument());
    expect(play).not.toHaveBeenCalled();
  });
});

// The artwork is a WebGL shader, and a browser keeps only a handful of contexts.
// Where nothing may move the baked still is the whole picture, so a card must not
// open a context only to draw that picture again.
describe("article artwork", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens no WebGL context for a card that cannot move", async () => {
    const collection = CONTENT_COLLECTIONS[0];
    const [still, moving] = collection?.articles ?? [];
    if (!collection || !still || !moving) throw new Error("This test needs a collection with two articles.");
    const stillFrame = articleGradient(still.title).frame;
    expect(articleGradient(moving.title).frame).not.toBe(stillFrame);
    shaderOpeningFrames.length = 0;

    // A reader who asked for less motion.
    const asked = stubMotionPreference(true);
    render(() => (
      <ArticleGradient mode="live" collection={collection} slug={still.slug} title={still.title} shape="featured" />
    ));
    await waitFor(() => expect(asked).toContain("(prefers-reduced-motion: reduce)"));

    // A touch screen, where a hover never ends.
    stubMotionPreference(false);
    render(() => (
      <ArticleGradient
        mode="hover"
        hoverTarget={() => document.body}
        collection={collection}
        slug={still.slug}
        title={still.title}
        shape="card"
      />
    ));

    // The one card here that may move. Cards draw their still one at a time, in
    // the order they arrive, so when this one opens a shader the two above have
    // already had their turn.
    render(() => (
      <ArticleGradient mode="live" collection={collection} slug={moving.slug} title={moving.title} shape="featured" />
    ));

    await waitFor(() => expect(shaderOpeningFrames.length).toBeGreaterThan(0));
    expect(shaderOpeningFrames).not.toContain(stillFrame);
  });
});
