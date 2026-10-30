import { createRouter } from "@tanstack/solid-router";
import { routeTree } from "./routeTree.gen";

const CHUNK_RELOAD_KEY = "openbot:chunk-reload-at";
const CHUNK_RELOAD_WINDOW_MS = 10_000;

// A deploy keeps the chunks of earlier builds for 24 hours (scripts/keep-previous-assets.ts). After that,
// or when a copy failed, a chunk is missing. Reload once to get the new build; if the chunk is still
// missing after that reload, let the error page show instead of looping.
if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event) => {
    try {
      const lastReload = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY));
      if (Date.now() - lastReload < CHUNK_RELOAD_WINDOW_MS) return;
      sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    } catch {
      return;
    }
    event.preventDefault();
    window.location.reload();
  });
}

/** The catalog that a page renders through `TextProvider`. Its loader returns it as `textCatalog`. */
function textCatalogOf(loaderData: unknown): string | undefined {
  if (typeof loaderData !== "object" || loaderData === null || !("textCatalog" in loaderData)) return undefined;
  return typeof loaderData.textCatalog === "string" ? loaderData.textCatalog : undefined;
}

export function getRouter() {
  const router = createRouter({
    routeTree,
    defaultPreload: "intent",
    // Components that read the catalog in the browser (the pricing order form) need it before hydration, or they
    // render English over the server's text. Loader data comes too late for that, so the router carries the locale.
    dehydrate: (): { textCatalog: string | undefined } => ({
      textCatalog: router.state.matches.map((match) => textCatalogOf(match.loaderData)).find(Boolean),
    }),
    hydrate: async (data: { textCatalog?: string | undefined }) => {
      const locale = data.textCatalog;
      if (!locale || locale === "en") return;
      const { loadLocale, TRANSLATED_LOCALES } = await import("@openbot/i18n");
      const translated = TRANSLATED_LOCALES.find((item) => item === locale);
      if (translated) await loadLocale(translated).catch(() => undefined);
    },
  });
  return router;
}

declare module "@tanstack/solid-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
