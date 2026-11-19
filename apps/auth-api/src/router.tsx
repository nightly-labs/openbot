import { createRouter } from "@tanstack/solid-router";
import { routeTree } from "./routeTree.gen";

const CHUNK_RELOAD_KEY = "openbot:chunk-reload-at";
const CHUNK_RELOAD_WINDOW_MS = 10_000;

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

function textCatalogOf(loaderData: unknown): string | undefined {
  if (typeof loaderData !== "object" || loaderData === null || !("textCatalog" in loaderData)) return undefined;
  return typeof loaderData.textCatalog === "string" ? loaderData.textCatalog : undefined;
}

export function getRouter() {
  const router = createRouter({
    routeTree,
    defaultPreload: "intent",
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
