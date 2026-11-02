import { findBrandAsset } from "../lib/brand-assets";

/** The files change only with a release of the site. */
const BRAND_ASSET_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";

/**
 * One logo file, built from the same text the page shows. Only a name from the list is served, and
 * the policy keeps the SVG inert even when a browser opens it as a page.
 */
export function brandAssetResponse(fileName: string): Response {
  const asset = findBrandAsset(fileName);
  if (!asset) return new Response("Not found", { status: 404 });
  return new Response(asset.svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": BRAND_ASSET_CACHE_CONTROL,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
