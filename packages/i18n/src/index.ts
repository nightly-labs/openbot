import { appTranslation } from "./app-catalogs";
import type { TranslatedLocale } from "./locale";
import { createTranslate, type MessageParams, type Translate } from "./message";
import { type AppMessages, en } from "./messages/en/index";

export { APP_LANGUAGES, type AppLanguage, DEFAULT_APP_LANGUAGE } from "@openbot/contracts/app-language";
export { type AppFormat, createFormat } from "./format";
export {
  formatLocale,
  type LayoutDirection,
  localeDirection,
  resolveLocale,
  TRANSLATED_LOCALES,
  type TranslatedLocale,
  withHourCycle,
} from "./locale";
export { loadLocale, localeLoaded } from "./locale-loading";
export {
  createTranslate,
  type Message,
  type MessageCatalog,
  type MessageParams,
  type PartialTranslation,
  type PluralMessage,
  type Translate,
} from "./message";
export type { AppMessages } from "./messages/en/index";
export { localizeSourceText, matchingSourceKeys, type SourceMessages, sourceText } from "./source-text";
export { en };

/** The desktop translator: every key of the desktop catalog, including shared and source keys. */
export type AppTranslate = Translate<AppMessages>;

/**
 * A key whose message takes no placeholders.
 *
 * A component that keeps a key in a list - a tab, a menu item, a column - holds this type rather
 * than `keyof AppMessages`. The wider union includes keys that need values, so `t(key)` on it would
 * demand a parameter object the list has no way to supply.
 */
export type AppTextKey = {
  [Key in keyof AppMessages]: Record<never, never> extends MessageParams<AppMessages[Key]> ? Key : never;
}[keyof AppMessages];

/** One translator per locale: a screen that reads `t` on every render must not rebuild it. */
const translators = new Map<TranslatedLocale, AppTranslate>();

/**
 * The translator for a resolved locale. English is both a catalog and every other catalog's fallback.
 *
 * A language the web build has not loaded yet reads English (see `loadLocale`). That translator is
 * not kept, so the first call after the load reads the language.
 */
export function translateFor(locale: TranslatedLocale): AppTranslate {
  const cached = translators.get(locale);
  if (cached) return cached;
  const translation = appTranslation(locale);
  if (!translation) return translateFor("en");
  const translate = createTranslate({ source: en, translation, locale, sourceLocale: "en" });
  translators.set(locale, translate);
  return translate;
}
