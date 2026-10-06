import { OPENBOT_SITE_URL } from "../lib/site-metadata";

const SITE_ORIGIN = new URL(OPENBOT_SITE_URL).origin;
const SITE_HOST = new URL(OPENBOT_SITE_URL).hostname;

/**
 * Sends `http://openbot.run` and `www.openbot.run` to `https://openbot.run`, so
 * search engines index one address. The zone route sends plain HTTP here too, and
 * the `www` route exists only for this redirect: `www` has no origin of its own.
 * 308 keeps the method and the body, and search engines read it as permanent.
 */
export function canonicalHostRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  const isWww = url.hostname === `www.${SITE_HOST}`;
  if (!isWww && !(url.hostname === SITE_HOST && url.protocol === "http:")) return null;
  return Response.redirect(`${SITE_ORIGIN}${url.pathname}${url.search}`, 308);
}

/**
 * The router answers a page address that ends in `/` with a 307 to the address
 * without it. A 307 is temporary, so search engines keep both addresses. This
 * makes that one redirect permanent and leaves every other 307 as it is.
 */
export function permanentTrailingSlashRedirect(request: Request, response: Response): Response {
  if (response.status !== 307 || (request.method !== "GET" && request.method !== "HEAD")) return response;
  const location = response.headers.get("Location");
  if (!location) return response;
  const url = new URL(request.url);
  const target = new URL(location, url);
  const trimmed = url.pathname.replace(/\/+$/, "");
  if (trimmed === "" || trimmed === url.pathname) return response;
  if (target.origin !== url.origin || target.pathname !== trimmed || target.search !== url.search) return response;
  return new Response(null, { status: 308, headers: response.headers });
}
