import { type AppLanguage, DEFAULT_APP_LANGUAGE } from "@openbot/contracts/ipc";
import { createTranslate, type Translate } from "./message";
import { en } from "./messages/en";
import { ja } from "./messages/ja";

export {
  createTranslate,
  type Message,
  type MessageCatalog,
  type MessageParams,
  type PluralMessage,
  type Translate,
  type Translation,
} from "./message";
export type { AppMessages } from "./messages/en";
export { en } from "./messages/en";
export { ja } from "./messages/ja";

/** The languages a catalog exists for. `"system"` resolves to one of these; it is never one itself. */
export const TRANSLATED_LOCALES = ["en", "ja"] as const;

export type TranslatedLocale = (typeof TRANSLATED_LOCALES)[number];

const catalogs = { en, ja } as const;

export type AppTranslate = Translate<typeof en>;

function isTranslatedLocale(value: string): value is TranslatedLocale {
  return TRANSLATED_LOCALES.some((locale) => locale === value);
}

/**
 * The locale to draw in, given the saved preference and the computer's own language.
 *
 * A system locale is matched on its language subtag, so `ja-JP` and `ja` both read Japanese, and
 * anything without a catalog falls back to English rather than to a half-translated screen.
 */
export function resolveLocale(language: AppLanguage, systemLocale: string): TranslatedLocale {
  if (language !== "system") {
    return isTranslatedLocale(language) ? language : "en";
  }
  const subtag = systemLocale.split("-")[0]?.toLowerCase() ?? "";
  return isTranslatedLocale(subtag) ? subtag : "en";
}

/** The translator for a resolved locale. English is both a catalog and every other catalog's fallback. */
export function translateFor(locale: TranslatedLocale): AppTranslate {
  return createTranslate({ source: en, translation: catalogs[locale], locale });
}

/** The translator for a preference, in one step, for a caller that holds no resolved locale. */
export function translateForLanguage(language: AppLanguage, systemLocale: string): AppTranslate {
  return translateFor(resolveLocale(language, systemLocale));
}

export type { AppLanguage };
export { DEFAULT_APP_LANGUAGE };
