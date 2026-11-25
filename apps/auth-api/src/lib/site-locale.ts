import type { AppTranslate, TranslatedLocale } from "@openbot/i18n";
import { loadPageText } from "./page-text";
import { SITE_LOCALES, type SiteLocale } from "./site-paths";
import { type SiteChrome, siteText } from "./site-text";

export const SITE_OPEN_GRAPH_LOCALES: Record<SiteLocale, string> = {
  en: "en_US",
  ar: "ar_AR",
  de: "de_DE",
  es: "es_ES",
  fr: "fr_FR",
  he: "he_IL",
  it: "it_IT",
  ja: "ja_JP",
  ko: "ko_KR",
  nl: "nl_NL",
  pl: "pl_PL",
  pt: "pt_BR",
  ru: "ru_RU",
  tr: "tr_TR",
  zh: "zh_CN",
};

export function siteLocale(locale: TranslatedLocale): SiteLocale {
  return SITE_LOCALES.find((item) => item === locale) ?? "en";
}

export async function loadSiteChrome(locale: SiteLocale): Promise<SiteChrome> {
  const { lang, dir, text } = await loadPageText(locale, siteText);
  return { lang, dir, locale, text };
}

export async function loadSitePage<Text>(locale: SiteLocale, build: (t: AppTranslate) => Text) {
  const [page, site] = await Promise.all([loadPageText(locale, build), loadSiteChrome(locale)]);
  return { ...page, site };
}
