import { createRouter } from "@tanstack/solid-router";
import { routeTree } from "./routeTree.gen";

const CHUNK_RELOAD_KEY = "openbot:chunk-reload-at";
const CHUNK_RELOAD_WINDOW_MS = 10_000;

// A deploy removes the previous build's chunks. Reload once to get the new build; if the chunk is
// still missing after that reload, let the error page show instead of looping.
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

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
  });
}

declare module "@tanstack/solid-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
