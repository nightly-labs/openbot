import { OPENBOT_SITE_URL } from "../lib/site-metadata";

const SITE_ORIGIN = new URL(OPENBOT_SITE_URL).origin;
const SITE_HOST = new URL(OPENBOT_SITE_URL).hostname;

export function canonicalHostRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  const isWww = url.hostname === `www.${SITE_HOST}`;
  if (!isWww && !(url.hostname === SITE_HOST && url.protocol === "http:")) return null;
  return Response.redirect(`${SITE_ORIGIN}${url.pathname}${url.search}`, 308);
}

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

export function installReturnPage(path: string, callbackUrl: URL): URL {
  return new URL(path, callbackUrl.hostname === `api.${SITE_HOST}` ? SITE_ORIGIN : callbackUrl);
}

export function companySignInApiOrigin(siteUrl: URL): string {
  return siteUrl.hostname === SITE_HOST ? `${siteUrl.protocol}//api.${SITE_HOST}` : siteUrl.origin;
}

export function inviteLinkOrigin(requestUrl: URL): string {
  return requestUrl.hostname === `api.${SITE_HOST}` ? SITE_ORIGIN : requestUrl.origin;
}
