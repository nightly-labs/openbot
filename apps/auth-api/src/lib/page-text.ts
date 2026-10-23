import type { AppTranslate, TranslatedLocale } from "@openbot/i18n";
import { appLanguageOption } from "@openbot/i18n/languages";

/** The text of one page in one language. Loader data carries it from the server to the browser. */
export interface PageText<Text> {
  /** The `lang` attribute of the page content. */
  lang: string;
  /** The catalog that the text came from. A page that renders catalog text in components gives it to `TextProvider`. */
  locale: TranslatedLocale;
  text: Text;
}

/**
 * Builds the text of a page in `locale`. A route loader calls it, so the server renders the text,
 * and hydration reads the same text from the loader data.
 *
 * The import is dynamic, so the catalogs are not in the site's main browser chunk. The browser loads
 * them only when it navigates to one of these pages. When a language does not load, the page shows
 * English.
 */
export async function loadPageText<Text>(
  locale: TranslatedLocale,
  build: (t: AppTranslate) => Text,
): Promise<PageText<Text>> {
  const { loadLocale, localeLoaded, translateFor } = await import("@openbot/i18n");
  await loadLocale(locale).catch(() => undefined);
  const shown = localeLoaded(locale) ? locale : "en";
  return { lang: appLanguageOption(shown).lang ?? shown, locale: shown, text: build(translateFor(shown)) };
}
