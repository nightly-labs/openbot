// The pages of the public site that have a Polish copy, and their addresses. No imports, so the
// header, the footer and the buttons can use these paths without the loaders' modules.

/** The languages of the pages in `POLISH_PAGE_PATHS`. All other pages of the site are in English. */
export const SITE_LOCALES = ["en", "pl"] as const;

export type SiteLocale = (typeof SITE_LOCALES)[number];

/**
 * The Polish address of each page that has a Polish copy. The English address shows the language of
 * the request (Polish for Polish, English for all others), and the Polish address always shows
 * Polish. Search engines read the two as alternates of one page.
 */
export const POLISH_PAGE_PATHS = {
  "/": "/pl",
  "/teams": "/pl/teams",
  "/pricing": "/pl/pricing",
  "/contact": "/pl/contact",
} as const;

export type EnglishPagePath = keyof typeof POLISH_PAGE_PATHS;

export type PolishPagePath = (typeof POLISH_PAGE_PATHS)[EnglishPagePath];

/** The address of `page` in each language. */
export function pagePaths(page: EnglishPagePath): Record<SiteLocale, EnglishPagePath | PolishPagePath> {
  return { en: page, pl: POLISH_PAGE_PATHS[page] };
}

function hasPolishCopy(path: string): path is EnglishPagePath {
  return Object.hasOwn(POLISH_PAGE_PATHS, path);
}

/**
 * The address of `path` for a page in `locale`: the Polish copy of a page that has one, or `path`.
 * A link on a Polish page goes to the Polish page, and a link on an English page keeps its address.
 */
export function localizedPath<Path extends string>(path: Path, locale: SiteLocale): Path | PolishPagePath {
  return locale === "pl" && hasPolishCopy(path) ? POLISH_PAGE_PATHS[path] : path;
}
