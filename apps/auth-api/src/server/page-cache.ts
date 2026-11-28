import { serverRequestLocale } from "../lib/request-locale";
import { siteUrlForPage } from "../lib/site-metadata";

const PAGE_CACHE_NAME = "site-pages";
const SHARED_PAGES = new Set(["/", "/app", "/app-preview"]);
const KEY_PREFIX = "/__openbot-page-cache";
const STORED_CACHE_CONTROL = "public, max-age=3600";
const ORIGINAL_CACHE_CONTROL = "X-OpenBot-Page-Cache-Control";
const ORIGINAL_VARY = "X-OpenBot-Page-Cache-Vary";
const ABSENT = "-";

export function sharedPageCache(
  request: Request,
  versionId: string | undefined,
  context: Pick<ExecutionContext, "waitUntil"> | undefined,
) {
  if (!context || typeof caches === "undefined") return null;
  const key = sharedPageKey(request, versionId);
  if (!key) return null;
  const cache = caches.open(PAGE_CACHE_NAME);
  return {
    cached: async () => {
      const stored = await cache.then((pages) => pages.match(key)).catch(() => undefined);
      return stored ? servedPage(stored) : undefined;
    },
    remember: (response: Response) => {
      const stored = storablePage(response);
      if (stored) context.waitUntil(cache.then((pages) => pages.put(key, stored)).catch(() => undefined));
    },
  };
}

function sharedPageKey(request: Request, versionId: string | undefined): Request | null {
  if (request.method !== "GET" || !versionId || request.headers.has("Authorization")) return null;
  const url = new URL(request.url);
  if (!SHARED_PAGES.has(url.pathname) || url.search !== "") return null;
  const locale = serverRequestLocale(request.headers.get("Cookie"), request.headers.get("Accept-Language"));
  const site = encodeURIComponent(siteUrlForPage(url));
  return new Request(new URL(`${KEY_PREFIX}/${encodeURIComponent(versionId)}/${site}/${locale}${url.pathname}`, url));
}

function storablePage(response: Response): Response | null {
  if (
    response.status !== 200 ||
    response.headers.has("Set-Cookie") ||
    !response.headers.get("Content-Type")?.startsWith("text/html")
  ) {
    return null;
  }
  const stored = new Response(response.clone().body, response);
  stored.headers.set(ORIGINAL_CACHE_CONTROL, response.headers.get("Cache-Control") ?? ABSENT);
  stored.headers.set(ORIGINAL_VARY, response.headers.get("Vary") ?? ABSENT);
  stored.headers.set("Cache-Control", STORED_CACHE_CONTROL);
  stored.headers.delete("Vary");
  return stored;
}

function servedPage(stored: Response): Response {
  const served = new Response(stored.body, stored);
  restoreHeader(served, "Cache-Control", ORIGINAL_CACHE_CONTROL);
  restoreHeader(served, "Vary", ORIGINAL_VARY);
  served.headers.delete("Age");
  served.headers.delete("CF-Cache-Status");
  return served;
}

function restoreHeader(response: Response, name: string, original: string) {
  const value = response.headers.get(original);
  response.headers.delete(original);
  if (value === null || value === ABSENT) response.headers.delete(name);
  else response.headers.set(name, value);
}
