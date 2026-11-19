import type { TranslatedLocale } from "./locale";
import { createTranslate, type MessageParams, type Translate } from "./message";
import { type AppMobileMessages, enMobile } from "./messages/en/mobile";
import { mobileCatalog } from "./mobile-catalogs";

export { APP_LANGUAGES, type AppLanguage, DEFAULT_APP_LANGUAGE, isAppLanguage } from "@openbot/contracts/app-language";
export { type AppFormat, createFormat } from "./format";
export { formatLocale, localeDirection, resolveLocale, TRANSLATED_LOCALES, type TranslatedLocale } from "./locale";
export { localizeSourceText, sourceText } from "./source-text";
export type { AppMobileMessages };

export type MobileTranslate = Translate<AppMobileMessages>;

export type MobileTextKey = {
  [Key in keyof AppMobileMessages]: Record<never, never> extends MessageParams<AppMobileMessages[Key]> ? Key : never;
}[keyof AppMobileMessages];

const translators = new Map<TranslatedLocale, MobileTranslate>();

export function mobileTranslateFor(locale: TranslatedLocale): MobileTranslate {
  const cached = translators.get(locale);
  if (cached) return cached;
  const translate = createTranslate({
    source: enMobile,
    translation: mobileCatalog(locale),
    locale,
    sourceLocale: "en",
  });
  translators.set(locale, translate);
  return translate;
}
