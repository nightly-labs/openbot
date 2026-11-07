// The pages of the public site that have a copy in each site language, and their addresses. No
// imports, so the header, the footer and the buttons can use these paths without the loaders' modules.

/** The languages of the pages in `LOCALIZED_PAGE_PATHS`. All other pages of the site are in English. */
export const SITE_LOCALES = ["en", "pl", "pt"] as const;

export type SiteLocale = (typeof SITE_LOCALES)[number];

/** The `hreflang` and `lang` value of each site language. The Portuguese copy is Brazilian Portuguese. */
const SITE_LANGUAGE_TAGS = { en: "en", pl: "pl", pt: "pt-BR" } as const satisfies Record<SiteLocale, string>;

/** The `hreflang` value of a page in `locale`. */
export function siteHreflang(locale: SiteLocale): string {
  return SITE_LANGUAGE_TAGS[locale];
}

/** The site languages that have their own addresses: all except English. */
export type TranslatedSiteLocale = Exclude<SiteLocale, "en">;

/**
 * The address of each page in each language other than English. The English address shows the
 * language of the request (a site language for that language, English for all others), and each
 * localized address always shows its language. Search engines read them as alternates of one page.
 */
export const LOCALIZED_PAGE_PATHS = {
  pl: {
    "/": "/pl",
    "/teams": "/pl/teams",
    "/pricing": "/pl/pricing",
    "/contact": "/pl/contact",
  },
  pt: {
    "/": "/pt",
    "/teams": "/pt/teams",
    "/pricing": "/pt/pricing",
    "/contact": "/pt/contact",
  },
} as const satisfies Record<TranslatedSiteLocale, Record<string, string>>;

export type EnglishPagePath = keyof (typeof LOCALIZED_PAGE_PATHS)["pl"];

export type LocalizedPagePath = (typeof LOCALIZED_PAGE_PATHS)[TranslatedSiteLocale][EnglishPagePath];

const TRANSLATED_SITE_LOCALES = SITE_LOCALES.filter((locale): locale is TranslatedSiteLocale => locale !== "en");

/** The address of `page` in each language. */
export function pagePaths(page: EnglishPagePath): Record<SiteLocale, EnglishPagePath | LocalizedPagePath> {
  return { en: page, pl: LOCALIZED_PAGE_PATHS.pl[page], pt: LOCALIZED_PAGE_PATHS.pt[page] };
}

function hasLocalizedCopy(path: string): path is EnglishPagePath {
  return Object.hasOwn(LOCALIZED_PAGE_PATHS.pl, path);
}

/**
 * The address of `path` for a page in `locale`: the copy in that language of a page that has one, or
 * `path`. A link on a Polish page goes to the Polish page, and a link on an English page keeps its address.
 */
export function localizedPath<Path extends string>(path: Path, locale: SiteLocale): Path | LocalizedPagePath {
  return locale !== "en" && hasLocalizedCopy(path) ? LOCALIZED_PAGE_PATHS[locale][path] : path;
}

/**
 * The cookie that keeps the language that the visitor chose in the header. It holds a `SiteLocale`,
 * and the English addresses show that language in place of the `Accept-Language` language.
 */
export const SITE_LOCALE_COOKIE = "openbot_lang";

/** The language in the value of `SITE_LOCALE_COOKIE`, or `undefined` for no value or another value. */
export function chosenSiteLocale(value: string | undefined): SiteLocale | undefined {
  return SITE_LOCALES.find((locale) => locale === value);
}

/** The page at `pathname`, when it is the English or a localized address of a page with localized copies. */
export function pageWithLocalizedCopy(pathname: string): EnglishPagePath | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return Object.keys(LOCALIZED_PAGE_PATHS.pl)
    .filter(hasLocalizedCopy)
    .find(
      (page) => page === path || TRANSLATED_SITE_LOCALES.some((locale) => LOCALIZED_PAGE_PATHS[locale][page] === path),
    );
}
