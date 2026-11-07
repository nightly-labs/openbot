import type { AppLanguage } from "@openbot/contracts/app-language";

/** The languages a catalog exists for. `"system"` resolves to one of these; it is never one itself. */
export const TRANSLATED_LOCALES = [
  "en",
  "ar",
  "de",
  "es",
  "fr",
  "he",
  "it",
  "ja",
  "ko",
  "nl",
  "pl",
  "pt",
  "ru",
  "tr",
  "zh",
] as const;

export type TranslatedLocale = (typeof TRANSLATED_LOCALES)[number];

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

/**
 * The locale for numbers and dates, given the same two values.
 *
 * The system preference keeps the computer's own locale, also when the text falls back to English:
 * a computer set to Polish keeps its day-month dates. A chosen language keeps the computer's region
 * only when it is the computer's language, so French on `fr-CA` formats as `fr-CA`.
 */
export function formatLocale(language: AppLanguage, systemLocale: string): string {
  const locale = resolveLocale(language, systemLocale);
  const subtag = systemLocale.split("-")[0]?.toLowerCase() ?? "";
  if (language !== "system" && subtag !== locale) return locale;
  try {
    return Intl.getCanonicalLocales(systemLocale)[0] ?? locale;
  } catch {
    return locale;
  }
}

/** The locales whose script runs from right to left. The interface mirrors for these. */
const RIGHT_TO_LEFT_LOCALES: ReadonlySet<TranslatedLocale> = new Set(["ar", "he"]);

export type LayoutDirection = "ltr" | "rtl";

/**
 * The `dir` of the interface for a locale. Only the layout follows it: each paragraph of user
 * content takes its own direction from its text (`dir="auto"`), whatever the interface language.
 */
export function localeDirection(locale: TranslatedLocale): LayoutDirection {
  return RIGHT_TO_LEFT_LOCALES.has(locale) ? "rtl" : "ltr";
}
