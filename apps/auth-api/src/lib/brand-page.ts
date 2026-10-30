// The route, date and meta of the /brand page. The logo files are in `brand-assets.ts`.
//
// No JSX here, for the same reason `teams-page.ts` holds none, and no logo data: analytics and the
// sitemap import this module.

export const BRAND_ROUTE = "/brand";

/** The sitemap date of the page. Change it when the page or a file changes. */
export const BRAND_PAGE_UPDATED_AT = "2026-10-26";

export const BRAND_PAGE_META = {
  title: "OpenBot brand",
  description: "Download the OpenBot logo as SVG or PNG, in each shape and color.",
} as const;
