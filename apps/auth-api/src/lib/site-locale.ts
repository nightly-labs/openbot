import type { AppTranslate, TranslatedLocale } from "@openbot/i18n";
import { loadPageText } from "./page-text";
import type { SiteLocale } from "./site-paths";
import { type SiteChrome, siteText } from "./site-text";

/** The `og:locale` value of each language. */
export const SITE_OPEN_GRAPH_LOCALES: Record<SiteLocale, string> = { en: "en_US", pl: "pl_PL" };

/** The page language for a request language: Polish for Polish, English for all others. */
export function siteLocale(locale: TranslatedLocale): SiteLocale {
  return locale === "pl" ? "pl" : "en";
}

/** The text of the header, the menu and the footer in `locale`, for a route loader to return as `site`. */
export async function loadSiteChrome(locale: SiteLocale): Promise<SiteChrome> {
  const { lang, text } = await loadPageText(locale, siteText);
  return { lang, locale, text };
}

/** The text of a page with a Polish copy, and of its header and footer, in `locale`. */
export async function loadSitePage<Text>(locale: SiteLocale, build: (t: AppTranslate) => Text) {
  const [page, site] = await Promise.all([loadPageText(locale, build), loadSiteChrome(locale)]);
  return { ...page, site };
}
