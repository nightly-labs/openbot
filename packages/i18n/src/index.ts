import type { AppLanguage } from "@openbot/contracts/app-language";
import { resolveLocale, type TranslatedLocale } from "./locale";
import { createTranslate, type MessageParams, type Translate } from "./message";
import { type AppMessages, en } from "./messages/en/index";
import { fr } from "./messages/fr/index";
import { ja } from "./messages/ja/index";

export { APP_LANGUAGES, type AppLanguage, DEFAULT_APP_LANGUAGE } from "@openbot/contracts/app-language";
export { type AppFormat, createFormat } from "./format";
export { formatLocale, resolveLocale, TRANSLATED_LOCALES, type TranslatedLocale } from "./locale";
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
export { localizeSourceText, type SourceMessages, sourceText } from "./source-text";
export { en, fr, ja };

const catalogs = { en, fr, ja } as const;

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

/** The translator for a resolved locale. English is both a catalog and every other catalog's fallback. */
export function translateFor(locale: TranslatedLocale): AppTranslate {
  const cached = translators.get(locale);
  if (cached) return cached;
  const translate = createTranslate({ source: en, translation: catalogs[locale], locale, sourceLocale: "en" });
  translators.set(locale, translate);
  return translate;
}

/** The translator for a preference, in one step, for a caller that holds no resolved locale. */
export function translateForLanguage(language: AppLanguage, systemLocale: string): AppTranslate {
  return translateFor(resolveLocale(language, systemLocale));
}
