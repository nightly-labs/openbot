export const APP_LANGUAGES = [
  "system",
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

export type AppLanguage = (typeof APP_LANGUAGES)[number];

export const DEFAULT_APP_LANGUAGE: AppLanguage = "system";

export interface AppLanguagePreference {
  language: AppLanguage;
}

export type SetAppLanguagePreferenceInput = AppLanguagePreference;

export function isAppLanguage(value: unknown): value is AppLanguage {
  return APP_LANGUAGES.some((language) => language === value);
}
