import type { AppTranslate, TranslatedLocale } from "@openbot/i18n";
import { appLanguageOption } from "@openbot/i18n/languages";

export interface PageText<Text> {
  lang: string;
  locale: TranslatedLocale;
  text: Text;
}

export async function loadPageText<Text>(
  locale: TranslatedLocale,
  build: (t: AppTranslate) => Text,
): Promise<PageText<Text>> {
  const { loadLocale, localeLoaded, translateFor } = await import("@openbot/i18n");
  await loadLocale(locale).catch(() => undefined);
  const shown = localeLoaded(locale) ? locale : "en";
  return { lang: appLanguageOption(shown).lang ?? shown, locale: shown, text: build(translateFor(shown)) };
}
