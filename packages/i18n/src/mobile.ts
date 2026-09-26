import type { TranslatedLocale } from "./locale";
import { createTranslate, type MessageParams, type Translate } from "./message";
import { type AppMobileMessages, enMobile } from "./messages/en/mobile";
import { frMobile } from "./messages/fr/mobile";
import { jaMobile } from "./messages/ja/mobile";

/**
 * The mobile entry. It carries the shared keys, the source text and the mobile areas only, so the
 * desktop catalog stays out of the Hermes bundle.
 */
export { APP_LANGUAGES, type AppLanguage, DEFAULT_APP_LANGUAGE, isAppLanguage } from "@openbot/contracts/app-language";
export { type AppFormat, createFormat } from "./format";
export { formatLocale, resolveLocale, TRANSLATED_LOCALES, type TranslatedLocale } from "./locale";
export { localizeSourceText, sourceText } from "./source-text";
export type { AppMobileMessages };

const catalogs = { en: enMobile, fr: frMobile, ja: jaMobile } as const;

export type MobileTranslate = Translate<AppMobileMessages>;

/** A mobile key whose message takes no placeholders. */
export type MobileTextKey = {
  [Key in keyof AppMobileMessages]: Record<never, never> extends MessageParams<AppMobileMessages[Key]> ? Key : never;
}[keyof AppMobileMessages];

const translators = new Map<TranslatedLocale, MobileTranslate>();

export function mobileTranslateFor(locale: TranslatedLocale): MobileTranslate {
  const cached = translators.get(locale);
  if (cached) return cached;
  const translate = createTranslate({ source: enMobile, translation: catalogs[locale], locale, sourceLocale: "en" });
  translators.set(locale, translate);
  return translate;
}
