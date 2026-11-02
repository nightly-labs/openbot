import {
  decodeHostedSiteRouteManifest,
  type HostedSiteRouteFile,
  type HostedSiteRouteManifest,
  hostedSiteBlockKey,
  hostedSiteRouteKey,
} from "@openbot/contracts/hosted-sites";
import { Context, Effect, Layer, Schema } from "effect";

interface SiteBucket {
  get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | R2Object | null>;
}

interface SiteRouterEnv {
  SITES: SiteBucket;
  SITE_SERVE_ENABLED?: string;
  /** Origin of the account service, such as `https://openbot.run`. The report route and error pages use it. */
  ACCOUNT_ORIGIN?: string;
}

interface SiteRouterRuntime {
  assetCache: Pick<Cache, "match" | "put">;
  schedule(work: Effect.Effect<void>): void;
}

export default {
  async fetch(request: Request, env: SiteRouterEnv, ctx: ExecutionContext): Promise<Response> {
    try {
      return await Effect.runPromise(
        Effect.gen(function* () {
          const assetCache = yield* openAssetCache();
          return yield* routeRequest(
            request,
            env,
            Date.now(),
            assetCache ? { assetCache, schedule: (work) => ctx.waitUntil(Effect.runPromise(work)) } : undefined,
          );
        }),
      );
    } catch (error) {
      console.error(JSON.stringify({ event: "site_router_error", message: errorMessage(error) }));
      return errorResponse(request, env, "siteFailed");
    }
  },
} satisfies ExportedHandler<SiteRouterEnv>;

class SiteStorageError extends Schema.TaggedError<SiteStorageError>()("SiteStorageError", {
  message: Schema.String,
}) {}

const storageCall = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (error) => new SiteStorageError({ message: errorMessage(error) }),
  });

class SiteStorage extends Context.Service<
  SiteStorage,
  {
    get(key: string, options?: R2GetOptions): Effect.Effect<R2ObjectBody | R2Object | null, SiteStorageError>;
  }
>()("@openbot/site-router/SiteStorage") {
  static layer(bucket: SiteBucket) {
    return Layer.succeed(
      SiteStorage,
      SiteStorage.of({
        get: Effect.fn("SiteStorage.get")((key: string, options?: R2GetOptions) =>
          storageCall(() => bucket.get(key, options)),
        ),
      }),
    );
  }
}

const openAssetCache = Effect.fn("SiteRouter.openAssetCache")(() =>
  storageCall(() => caches.open("openbot-site-assets-v1")).pipe(
    Effect.catch((error) => {
      console.error(JSON.stringify({ event: "site_asset_cache_open_error", message: error.message }));
      return Effect.succeed(undefined);
    }),
  ),
);

export const routeRequest = Effect.fn("SiteRouter.routeRequest")(
  function* (request: Request, env: SiteRouterEnv, now: number, runtime?: SiteRouterRuntime) {
    const storage = yield* SiteStorage;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const response = errorResponse(request, env, "methodNotAllowed");
      response.headers.set("Allow", "GET, HEAD");
      return response;
    }
    if (env.SITE_SERVE_ENABLED !== "true") return errorResponse(request, env, "hostingDisabled");

    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();
    if (!isHostedSiteHostname(hostname)) return errorResponse(request, env, "siteNotFound");
    if (url.pathname === "/_openbot/report" || url.pathname === "/_openbot/report/") {
      const report = accountUrl(env, "/report-site");
      if (!report) return errorResponse(request, env, "reportUnavailable");
      report.searchParams.set("hostname", hostname);
      return new Response(null, {
        status: 302,
        headers: secureHeaders({ Location: report.toString(), "Cache-Control": "no-store" }),
      });
    }
    // Read both keys at once. The block marker still wins, also when the route read fails.
    const [blockMarker, routeRead] = yield* Effect.all(
      [storage.get(hostedSiteBlockKey(hostname)), Effect.result(storage.get(hostedSiteRouteKey(hostname)))],
      { concurrency: 2 },
    );
    if (blockMarker) return errorResponse(request, env, "siteBlocked");

    const routeObject = yield* Effect.fromResult(routeRead);
    if (!routeObject) return errorResponse(request, env, "siteNotFound");
    if (!hasBody(routeObject)) return errorResponse(request, env, "siteFailed");
    const route = yield* readRouteManifest(routeObject);
    if (!route) return errorResponse(request, env, "siteFailed");
    if (route.status === "deleted" || route.status === "expired") return errorResponse(request, env, "siteGone");
    if (route.status === "blocked") return errorResponse(request, env, "siteBlocked");
    if (route.expiresAt === null || route.expiresAt <= now) return errorResponse(request, env, "siteGone");

    const path = requestPath(url.pathname);
    if (path === null) return errorResponse(request, env, "pageNotFound");
    const file = resolveFile(route, path);
    if (file === "directory") {
      // The relative Location keeps local hosted sites on their own origin; one leading slash keeps it on this host.
      return new Response(null, {
        status: 308,
        headers: secureHeaders({
          Location: `/${url.pathname.replace(/^\/+/, "")}/${url.search}`,
          "Cache-Control": "no-store",
        }),
      });
    }
    if (!file) return errorResponse(request, env, "pageNotFound");
    if (file.mimeType !== "text/html" && runtime) {
      const cached = yield* readCachedAsset(request, file, runtime.assetCache);
      if (cached) return assetResponse(request, file, cached.body, cached.headers.get("ETag"));
    }
    const revalidation = assetRevalidationHeaders(request, file.mimeType);
    const object = yield* storage.get(file.key, revalidation ? { onlyIf: revalidation } : undefined);
    if (!object || object.size !== file.size) return errorResponse(request, env, "pageNotFound");

    if (!hasBody(object)) return assetResponse(request, file, null, object.httpEtag, 304);
    if (file.mimeType === "text/html" || request.method === "HEAD" || !runtime) {
      return assetResponse(request, file, object.body, object.httpEtag);
    }

    const cacheResponse = new Response(object.body, {
      headers: {
        "Cache-Control": "public, max-age=2764800, immutable",
        "Content-Length": String(object.size),
        ETag: object.httpEtag,
      },
    });
    // This independent Effect owns the cache write until waitUntil settles. The response
    // body remains owned by the Worker; returning it does not close the stream.
    runtime.schedule(
      storageCall(() => runtime.assetCache.put(assetCacheRequest(request, file), cacheResponse.clone())).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            console.error(JSON.stringify({ event: "site_asset_cache_write_error", message: error.message }));
          }),
        ),
      ),
    );
    return assetResponse(request, file, cacheResponse.body, object.httpEtag);
  },
  (operation, _request, env, _now, _runtime?: SiteRouterRuntime) =>
    operation.pipe(Effect.provide(SiteStorage.layer(env.SITES))),
);

const readCachedAsset = Effect.fn("SiteRouter.readCachedAsset")(
  (request: Request, file: HostedSiteRouteFile, cache: Pick<Cache, "match">) =>
    storageCall(() => cache.match(assetCacheRequest(request, file))).pipe(
      Effect.map((cached) => {
        if (cached?.status !== 200) return undefined;
        if (cached.headers.get("Content-Length") !== String(file.size) || !cached.headers.has("ETag")) return undefined;
        return cached;
      }),
      Effect.catch((error) => {
        console.error(JSON.stringify({ event: "site_asset_cache_read_error", message: error.message }));
        return Effect.succeed(undefined);
      }),
    ),
);

function assetCacheRequest(request: Request, file: HostedSiteRouteFile): Request {
  const url = new URL(request.url);
  url.pathname = `/_openbot/asset-cache/${encodeURIComponent(file.key)}`;
  url.search = "";
  return new Request(url, { method: "GET" });
}

function assetResponse(
  request: Request,
  file: HostedSiteRouteFile,
  body: ReadableStream | null,
  etag: string | null,
  status = 200,
): Response {
  const headers = secureHeaders({
    "Content-Type": file.mimeType,
    "Cache-Control": file.mimeType === "text/html" ? "no-store" : "public, no-cache",
  });
  if (file.mimeType !== "text/html" && etag) headers.set("ETag", etag);
  if (status === 304 || (file.mimeType !== "text/html" && etag && requestEtagMatches(request, etag))) {
    return new Response(null, { status: 304, headers });
  }
  headers.set("Content-Length", String(file.size));
  return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
}

function requestEtagMatches(request: Request, etag: string): boolean {
  const ifNoneMatch = request.headers.get("If-None-Match");
  if (!ifNoneMatch) return false;
  const normalizedEtag = etag.replace(/^W\//u, "");
  return ifNoneMatch.split(",").some((candidate) => {
    const normalizedCandidate = candidate.trim();
    return normalizedCandidate === "*" || normalizedCandidate.replace(/^W\//u, "") === normalizedEtag;
  });
}

function assetRevalidationHeaders(request: Request, mimeType: string): Headers | null {
  if (mimeType === "text/html") return null;
  const ifNoneMatch = request.headers.get("If-None-Match");
  if (!ifNoneMatch) return null;
  return new Headers({ "If-None-Match": ifNoneMatch });
}

function hasBody(object: R2Object | R2ObjectBody): object is R2ObjectBody {
  return "body" in object;
}

function isHostedSiteHostname(hostname: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.openbot\.site$/u.test(hostname);
}

function requestPath(pathname: string): string | null {
  try {
    const decoded = pathname
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/")
      .replace(/^\/+/, "");
    if (decoded.includes("\\") || decoded.split("/").some((segment) => segment === "." || segment === "..")) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Returns "directory" for a directory address with no final slash. The caller redirects it, because
 * the browser resolves the relative links of a directory page one level up without the slash.
 */
function resolveFile(route: HostedSiteRouteManifest, path: string): HostedSiteRouteFile | "directory" | null {
  // Own keys only: `/constructor` must not find a member of `Object.prototype`.
  const fileAt = (key: string) => (Object.hasOwn(route.files, key) ? route.files[key] : undefined);
  if (!path) return fileAt("index.html") ?? null;
  const file = fileAt(path) ?? (path.endsWith("/") ? fileAt(`${path}index.html`) : undefined);
  if (file) return file;
  if (!path.endsWith("/") && fileAt(`${path}/index.html`)) return "directory";
  return route.spaFallback ? (fileAt("index.html") ?? null) : null;
}

const readRouteManifest = Effect.fn("SiteRouter.readRouteManifest")(function* (object: R2ObjectBody) {
  if (object.size > 64 * 1024) return null;
  return yield* storageCall(() => object.json()).pipe(
    Effect.flatMap((value) =>
      Effect.try({
        try: () => decodeHostedSiteRouteManifest(value),
        catch: () => new SiteStorageError({ message: "Invalid route manifest" }),
      }),
    ),
    Effect.catch(() => Effect.succeed(null)),
  );
});

/**
 * `text` is the plain-text body. Clients that do not ask for HTML get it byte for byte as before.
 * `title` and `detail` are for the HTML page that a browser gets.
 */
const siteErrors = {
  methodNotAllowed: {
    status: 405,
    text: "Method not allowed",
    title: "Action not allowed",
    detail: "This site only accepts page visits. Go back and open the page again.",
  },
  hostingDisabled: {
    status: 503,
    text: "Site hosting is temporarily unavailable",
    title: "Site hosting is paused",
    detail: "OpenBot sites are temporarily unavailable. Try again later.",
  },
  siteNotFound: {
    status: 404,
    text: "Site not found",
    title: "Site not found",
    detail: "No OpenBot site uses this address. Make sure that the address is correct.",
  },
  siteBlocked: {
    status: 451,
    text: "Site unavailable",
    title: "Site unavailable",
    detail: "OpenBot blocked this site. You cannot open it.",
  },
  siteFailed: {
    status: 500,
    text: "Site unavailable",
    title: "Site unavailable",
    detail: "OpenBot could not load this site. Try again in a few minutes.",
  },
  siteGone: {
    status: 410,
    text: "Site no longer available",
    title: "Site no longer available",
    detail: "The owner deleted this site, or it expired. Ask the owner for the new address.",
  },
  pageNotFound: {
    status: 404,
    text: "Page not found",
    title: "Page not found",
    detail: "This site has no page at this address. Open the home page of the site.",
  },
  reportUnavailable: {
    status: 503,
    text: "Site reports are unavailable",
    title: "Reports are unavailable",
    detail: "You cannot report this site from here now. Try again later.",
  },
} as const satisfies Record<string, { status: number; text: string; title: string; detail: string }>;

type SiteError = keyof typeof siteErrors;

function errorResponse(request: Request, env: SiteRouterEnv, error: SiteError): Response {
  const { status, text } = siteErrors[error];
  const headers = secureHeaders({
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    Vary: "Accept",
  });
  if (!acceptsHtml(request)) return new Response(text, { status, headers });

  const nonce = crypto.randomUUID().replaceAll("-", "");
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'none'`,
  );
  return new Response(errorPage(request, env, error, nonce), { status, headers });
}

/** True when the request lists `text/html` with a quality above zero. A wildcard alone is not enough. */
function acceptsHtml(request: Request): boolean {
  const accept = request.headers.get("Accept");
  if (!accept) return false;
  return accept.split(",").some((range) => {
    const [type, ...params] = range.split(";").map((part) => part.trim().toLowerCase());
    if (type !== "text/html") return false;
    const quality = params.find((param) => param.startsWith("q="));
    return quality === undefined || Number(quality.slice(2)) > 0;
  });
}

const errorPageStyle = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#1a1a1a;color:#fff;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{width:100%;max-width:440px;padding:32px;border:1px solid rgba(255,255,255,.07);border-radius:18px;background:#212121}
.brand{margin:0 0 24px;color:#d6adf2;font-weight:600;letter-spacing:-.01em}
.meta{margin:0 0 8px;color:#979797;font-size:13px;overflow-wrap:anywhere}
h1{margin:0 0 8px;font-size:24px;line-height:1.25;letter-spacing:-.02em}
p{margin:0;color:#dcdcdc}
nav{display:flex;flex-wrap:wrap;gap:16px;margin-top:24px}
a{color:#42a0ff;text-decoration:none;font-weight:500}
a:hover,a:focus-visible{text-decoration:underline}
`;

function errorPage(request: Request, env: SiteRouterEnv, error: SiteError, nonce: string): string {
  const { status, title, detail } = siteErrors[error];
  const hostname = new URL(request.url).hostname;
  const home = accountUrl(env, "/");
  const links = [
    error === "pageNotFound" ? `<a href="/">Open the site home page</a>` : "",
    home ? `<a href="${escapeHtml(home.toString())}">Go to OpenBot</a>` : "",
  ].join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} - OpenBot</title>
<style nonce="${nonce}">${errorPageStyle}</style>
</head>
<body>
<main>
<p class="brand">OpenBot</p>
<p class="meta">Error ${status} - ${escapeHtml(hostname)}</p>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(detail)}</p>
${links ? `<nav>${links}</nav>` : ""}
</main>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => `&#${character.charCodeAt(0)};`);
}

/** Returns a URL on the account service origin, or null when `ACCOUNT_ORIGIN` is absent or not an HTTP origin. */
function accountUrl(env: SiteRouterEnv, path: string): URL | null {
  if (!env.ACCOUNT_ORIGIN) return null;
  try {
    const origin = new URL(env.ACCOUNT_ORIGIN);
    if (origin.protocol !== "https:" && origin.protocol !== "http:") return null;
    return new URL(path, origin.origin);
  } catch {
    return null;
  }
}

function secureHeaders(input: HeadersInit): Headers {
  const headers = new Headers(input);
  headers.set("Content-Security-Policy", "worker-src 'none'");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.delete("Set-Cookie");
  return headers;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}
