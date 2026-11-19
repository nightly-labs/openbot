export const SITE_LOCALES = ["en", "pl", "pt"] as const;

export type SiteLocale = (typeof SITE_LOCALES)[number];

const SITE_LANGUAGE_TAGS = { en: "en", pl: "pl", pt: "pt-BR" } as const satisfies Record<SiteLocale, string>;

export function siteHreflang(locale: SiteLocale): string {
  return SITE_LANGUAGE_TAGS[locale];
}

export type TranslatedSiteLocale = Exclude<SiteLocale, "en">;

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

export function pagePaths(page: EnglishPagePath): Record<SiteLocale, EnglishPagePath | LocalizedPagePath> {
  return { en: page, pl: LOCALIZED_PAGE_PATHS.pl[page], pt: LOCALIZED_PAGE_PATHS.pt[page] };
}

function hasLocalizedCopy(path: string): path is EnglishPagePath {
  return Object.hasOwn(LOCALIZED_PAGE_PATHS.pl, path);
}

export function localizedPath<Path extends string>(path: Path, locale: SiteLocale): Path | LocalizedPagePath {
  return locale !== "en" && hasLocalizedCopy(path) ? LOCALIZED_PAGE_PATHS[locale][path] : path;
}

export const SITE_LOCALE_COOKIE = "openbot_lang";

export function chosenSiteLocale(value: string | undefined): SiteLocale | undefined {
  return SITE_LOCALES.find((locale) => locale === value);
}

export function pageWithLocalizedCopy(pathname: string): EnglishPagePath | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return Object.keys(LOCALIZED_PAGE_PATHS.pl)
    .filter(hasLocalizedCopy)
    .find(
      (page) => page === path || TRANSLATED_SITE_LOCALES.some((locale) => LOCALIZED_PAGE_PATHS[locale][page] === path),
    );
}
