import type { TranslatedLocale } from "@openbot/i18n";
import { appLanguageOption } from "@openbot/i18n/languages";

export const SITE_LOCALES = [
  "en",
  "ar",
  "de",
  "es",
  "fr",
  "he",
  "it",
  "ja",
  "ko",
  "nl",
  "pl",
  "pt",
  "ru",
  "tr",
  "zh",
] as const satisfies readonly TranslatedLocale[];

export type SiteLocale = (typeof SITE_LOCALES)[number];

export function siteHreflang(locale: SiteLocale): string {
  return appLanguageOption(locale).lang ?? locale;
}

export type TranslatedSiteLocale = Exclude<SiteLocale, "en">;

const LOCALIZED_PAGES = ["/", "/teams", "/pricing", "/contact"] as const;

export type EnglishPagePath = (typeof LOCALIZED_PAGES)[number];

export type LocalizedPagePath<
  Locale extends TranslatedSiteLocale = TranslatedSiteLocale,
  Page extends EnglishPagePath = EnglishPagePath,
> = Page extends "/" ? `/${Locale}` : `/${Locale}${Page}`;

export const TRANSLATED_SITE_LOCALES = SITE_LOCALES.filter((locale): locale is TranslatedSiteLocale => locale !== "en");

export function localizedPagePath<Locale extends TranslatedSiteLocale, Page extends EnglishPagePath>(
  locale: Locale,
  page: Page,
): LocalizedPagePath<Locale, Page>;
export function localizedPagePath(locale: TranslatedSiteLocale, page: EnglishPagePath): string {
  return page === "/" ? `/${locale}` : `/${locale}${page}`;
}

export function pagePaths(page: EnglishPagePath): Record<SiteLocale, EnglishPagePath | LocalizedPagePath> {
  const paths: Record<SiteLocale, EnglishPagePath | LocalizedPagePath> = {
    en: page,
    ar: localizedPagePath("ar", page),
    de: localizedPagePath("de", page),
    es: localizedPagePath("es", page),
    fr: localizedPagePath("fr", page),
    he: localizedPagePath("he", page),
    it: localizedPagePath("it", page),
    ja: localizedPagePath("ja", page),
    ko: localizedPagePath("ko", page),
    nl: localizedPagePath("nl", page),
    pl: localizedPagePath("pl", page),
    pt: localizedPagePath("pt", page),
    ru: localizedPagePath("ru", page),
    tr: localizedPagePath("tr", page),
    zh: localizedPagePath("zh", page),
  };
  return paths;
}

function hasLocalizedCopy(path: string): path is EnglishPagePath {
  return LOCALIZED_PAGES.some((page) => page === path);
}

export function localizedPath<Path extends string>(path: Path, locale: SiteLocale): Path | LocalizedPagePath {
  return locale !== "en" && hasLocalizedCopy(path) ? localizedPagePath(locale, path) : path;
}

export const SITE_LOCALE_COOKIE = "openbot_lang";

export function chosenSiteLocale(value: string | undefined): SiteLocale | undefined {
  return SITE_LOCALES.find((locale) => locale === value);
}

export function pageWithLocalizedCopy(pathname: string): EnglishPagePath | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return LOCALIZED_PAGES.find(
    (page) => page === path || TRANSLATED_SITE_LOCALES.some((locale) => localizedPagePath(locale, page) === path),
  );
}
