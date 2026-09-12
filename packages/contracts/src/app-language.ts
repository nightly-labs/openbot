/**
 * The language the app draws its interface in, and the identifiers a saved preference holds.
 *
 * `"system"` follows the language of the computer. It is the default, so a fresh install reads in
 * the user's language before anyone opens Settings, and an explicit choice is only the override.
 *
 * The identifiers are BCP 47 tags and cross the IPC boundary as written. Add a language, never
 * rename a tag: a renamed tag reads back as an unknown language on the next launch.
 */
export const APP_LANGUAGES = ["system", "en", "ja"] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number];

export const DEFAULT_APP_LANGUAGE: AppLanguage = "system";

/** The preference as it is stored and as it crosses IPC. */
export interface AppLanguagePreference {
  language: AppLanguage;
}

export type SetAppLanguagePreferenceInput = AppLanguagePreference;

export function isAppLanguage(value: unknown): value is AppLanguage {
  return APP_LANGUAGES.some((language) => language === value);
}
