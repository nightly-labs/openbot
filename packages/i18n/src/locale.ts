import type { AppLanguage } from "@openbot/contracts/app-language";
import type { HourCycle } from "@openbot/contracts/ipc";

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

export function resolveLocale(language: AppLanguage, systemLocale: string): TranslatedLocale {
  if (language !== "system") {
    return isTranslatedLocale(language) ? language : "en";
  }
  const subtag = systemLocale.split("-")[0]?.toLowerCase() ?? "";
  return isTranslatedLocale(subtag) ? subtag : "en";
}

export function formatLocale(language: AppLanguage, systemLocale: string, hourCycle?: HourCycle): string {
  return withHourCycle(dateLocale(language, systemLocale), hourCycle);
}

export function withHourCycle(tag: string, hourCycle: HourCycle | undefined): string {
  if (!hourCycle) return tag;
  try {
    return new Intl.Locale(tag, { hourCycle }).toString();
  } catch {
    return tag;
  }
}

function dateLocale(language: AppLanguage, systemLocale: string): string {
  const locale = resolveLocale(language, systemLocale);
  const subtag = systemLocale.split("-")[0]?.toLowerCase() ?? "";
  if (language !== "system" && subtag !== locale) return locale;
  try {
    return Intl.getCanonicalLocales(systemLocale)[0] ?? locale;
  } catch {
    return locale;
  }
}

const RIGHT_TO_LEFT_LOCALES: ReadonlySet<TranslatedLocale> = new Set(["ar", "he"]);

export type LayoutDirection = "ltr" | "rtl";

export function localeDirection(locale: TranslatedLocale): LayoutDirection {
  return RIGHT_TO_LEFT_LOCALES.has(locale) ? "rtl" : "ltr";
}
