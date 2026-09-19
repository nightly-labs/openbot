// A listing's own icon, served from openbot.run rather than from the developer who published it.
//
// The catalog carries an `iconUrl` on each listing and each of its apps, and those addresses are
// the developer's own servers. The desktop app fetches them directly; a public page must not, because
// then every reader of /plugins/<slug> announces themselves to canva.com and aave.com, and
// PRIVACY.md describes no such connection. This module is the one place that address is read: the
// Worker fetches it, and the page asks this origin for the picture.
//
// Nothing here takes a URL from a request. The slug names a listing, the listing names the address,
// and an address the catalog does not hold cannot be reached through this route.

import { findPlugin } from "../lib/plugins";

/**
 * A day, not a year: the catalog is a literal in this repository today and becomes a document
 * fetched from openbot.run, so a listing can change its icon without the page's address changing.
 * `stale-while-revalidate` is what keeps that from costing a reader the wait.
 */
const ICON_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * SVG is left out on purpose. It is the one image type that carries script, and a file served from
 * this origin runs as this origin: a listing whose icon became an SVG would otherwise be a way to
 * run code on openbot.run.
 */
function isServableImage(contentType: string): boolean {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return type.startsWith("image/") && type !== "image/svg+xml";
}

/** The address the catalog holds for this listing, if it is one the web can be fetched over. */
function iconSource(slug: string, appId: string | null): string | null {
  const plugin = findPlugin(slug);
  if (!plugin) return null;
  if (appId) {
    const app = plugin.apps.find((candidate) => candidate.id === appId);
    return app?.iconUrl ?? null;
  }
  return plugin.iconUrl;
}

export async function pluginIconResponse(slug: string, appId: string | null): Promise<Response> {
  const source = iconSource(slug, appId);
  if (!source) return notFound();

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return notFound();
  }
  if (url.protocol !== "https:") return notFound();

  let upstream: Response;
  try {
    upstream = await fetch(url, { headers: { Accept: "image/*" }, redirect: "follow" });
  } catch {
    return notFound();
  }
  const contentType = upstream.headers.get("Content-Type") ?? "";
  if (!upstream.ok || !isServableImage(contentType)) return notFound();

  return new Response(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": ICON_CACHE_CONTROL,
      // The picture is a developer's, and it is served from this origin: nosniff is what keeps a
      // mislabelled body from being read as anything but the type the header names.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
