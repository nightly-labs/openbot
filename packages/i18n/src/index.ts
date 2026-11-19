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

export type AppTranslate = Translate<AppMessages>;

export type AppTextKey = {
  [Key in keyof AppMessages]: Record<never, never> extends MessageParams<AppMessages[Key]> ? Key : never;
}[keyof AppMessages];

const translators = new Map<TranslatedLocale, AppTranslate>();

export function translateFor(locale: TranslatedLocale): AppTranslate {
  const cached = translators.get(locale);
  if (cached) return cached;
  const translation = appTranslation(locale);
  if (!translation) return translateFor("en");
  const translate = createTranslate({ source: en, translation, locale, sourceLocale: "en" });
  translators.set(locale, translate);
  return translate;
}
