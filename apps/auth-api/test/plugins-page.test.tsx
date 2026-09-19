import { createOpenBotPluginUrl } from "@openbot/contracts/plugin-links";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import type { JSX } from "@solidjs/web";
import { createRootRoute, createRoute, createRouter, isNotFound, RouterContextProvider } from "@tanstack/solid-router";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginPage } from "../src/components/plugins/PluginPage";
import { PluginsIndexPage } from "../src/components/plugins/PluginsIndexPage";
import { pluginExternalHref, pluginPath, SITE_PLUGINS } from "../src/lib/plugins";
import { loadPlugin } from "../src/routes/plugins/$slug";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * The routes these pages link to, declared rather than taken from the generated tree: that tree also
 * carries the sitemap handler, which imports `cloudflare:workers` and cannot load outside a Worker.
 * Nothing is lost, because a component that names a route the real tree does not hold fails the type
 * check. The same reason `content.test.tsx` gives.
 */
function renderPage(page: () => JSX.Element) {
  const rootRoute = createRootRoute();
  rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/news" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/guides" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/plugins" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/plugins/$slug" }),
  ]);
  const router = createRouter({ routeTree: rootRoute });
  return render(() => <RouterContextProvider router={router}>{page}</RouterContextProvider>);
}

const firstPlugin = () => {
  const plugin = SITE_PLUGINS[0];
  if (!plugin) throw new Error("The catalog must hold at least one plugin.");
  return plugin;
};

describe("plugins index", () => {
  // Also what keeps the card's artwork out of its name: the mark and the gradient inside the link
  // are hidden from assistive technology, so a single `getByRole` still resolves one link per
  // listing rather than failing on a name the decoration repeated.
  it("offers every plugin in the catalog as a link to its own page", () => {
    renderPage(() => <PluginsIndexPage />);

    for (const plugin of SITE_PLUGINS) {
      const link = screen.getByRole("link", { name: (name) => name.includes(plugin.name) });
      expect(link).toHaveAttribute("href", pluginPath(plugin.slug));
    }
  });

  /* The filters are the one thing on this page that can hide a listing, so the consequence worth
     asserting is that pressing one keeps the plugins carrying that tag and drops the rest, and that
     pressing it again brings them back. */
  it("keeps only the plugins carrying a tag a reader switches on", async () => {
    renderPage(() => <PluginsIndexPage />);
    const design = screen.getByRole("button", { name: "Design" });

    fireEvent.click(design);
    flush();

    expect(design).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: (name) => name.includes("Canva") })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: (name) => name.includes("Aave") })).not.toBeInTheDocument();

    fireEvent.click(design);
    flush();

    expect(screen.getByRole("link", { name: (name) => name.includes("Aave") })).toBeInTheDocument();
  });

  /* `All` is the way back, and it is the only switch a reader can press without having pressed
     anything first, so what it has to keep true is that it holds the resting state and that it
     lets every listing back however many tags were on. */
  it("returns the whole catalog when a reader presses All", async () => {
    renderPage(() => <PluginsIndexPage />);
    const all = screen.getByRole("button", { name: "All" });

    expect(all).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Design" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign-in" }));
    flush();

    expect(all).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(all);
    flush();

    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Design" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByRole("link", { name: (name) => name.includes("v1.0.0") })).toHaveLength(SITE_PLUGINS.length);
  });
});

describe("plugin page", () => {
  it("shows the listing a reader came for", () => {
    const plugin = firstPlugin();
    renderPage(() => <PluginPage plugin={plugin} />);

    expect(screen.getByRole("heading", { level: 1, name: plugin.name })).toBeInTheDocument();
    expect(screen.getByText(plugin.tagline)).toBeInTheDocument();
    expect(screen.getByText(plugin.description)).toBeInTheDocument();
    for (const prompt of plugin.prompts) {
      expect(screen.getByText(prompt.text)).toBeInTheDocument();
    }
  });

  /* The one way off this page that is not the app or the site header, and the only navigable thing
     the article layout added. */
  it("leads back to the whole catalog", () => {
    const plugin = firstPlugin();
    renderPage(() => <PluginPage plugin={plugin} />);

    expect(screen.getByRole("link", { name: "All plugins" })).toHaveAttribute("href", "/plugins");
  });

  it("opens the listing in the app with a link built from the slug", () => {
    const plugin = firstPlugin();
    renderPage(() => <PluginPage plugin={plugin} />);

    expect(screen.getByRole("link", { name: "Open in OpenBot" })).toHaveAttribute(
      "href",
      `openbot://plugins/${plugin.slug}`,
    );
    expect(createOpenBotPluginUrl(plugin.slug)).toBe(`openbot://plugins/${plugin.slug}`);
  });

  /* The catalog becomes a fetched document, and a link row is the only place a listing's own string
     reaches an `href`. A scheme that is not the web's must lose the row, not gain a link. */
  it("drops a link a listing points at a scheme that is not the web's", () => {
    const plugin = { ...firstPlugin(), websiteUrl: "javascript:alert(1)", termsUrl: null };
    renderPage(() => <PluginPage plugin={plugin} />);

    expect(screen.queryByRole("link", { name: /alert/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Website")).not.toBeInTheDocument();
    expect(pluginExternalHref("javascript:alert(1)")).toBeNull();
    expect(pluginExternalHref("https://canva.com")).toBe("https://canva.com/");
  });

  /* The address of an app's MCP server is the one thing the app knows that this page must not print.
     A reader who learns it can add the server by hand and skip every check the install makes. */
  it("never prints the address of a plugin's MCP server", () => {
    for (const plugin of SITE_PLUGINS) {
      const { container } = renderPage(() => <PluginPage plugin={plugin} />);

      for (const app of plugin.apps) {
        if (app.server.url) expect(container.textContent).not.toContain(app.server.url);
      }

      cleanup();
    }
  });

  it("offers the download only after the reader asks the app to open", () => {
    vi.useFakeTimers();
    const plugin = firstPlugin();
    renderPage(() => <PluginPage plugin={plugin} />);

    expect(screen.queryByRole("link", { name: /^Download for / })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Open in OpenBot" }));
    vi.advanceTimersByTime(2000);
    flush();

    expect(screen.getByRole("link", { name: /^Download for / })).toBeInTheDocument();
  });

  /* Hiding the tab is what happens when the app really does take over, so the offer to download is
     withdrawn rather than shown behind the window the reader has just left. */
  it("withdraws the download offer when the app takes over the tab", () => {
    vi.useFakeTimers();
    const plugin = firstPlugin();
    renderPage(() => <PluginPage plugin={plugin} />);

    fireEvent.click(screen.getByRole("link", { name: "Open in OpenBot" }));
    window.dispatchEvent(new Event("pagehide"));
    vi.advanceTimersByTime(2000);
    flush();

    expect(screen.queryByRole("link", { name: /^Download for / })).not.toBeInTheDocument();
  });

  it("answers a slug the catalog does not hold with a not-found response", () => {
    expect.assertions(1);
    try {
      loadPlugin("not-a-plugin");
    } catch (error) {
      expect(isNotFound(error)).toBe(true);
    }
  });
});
