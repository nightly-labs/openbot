import { APP_LANGUAGES, type AppLanguage } from "@openbot/contracts/ipc";

/**
 * The rows of the language selector.
 *
 * The identifiers come from the contract, so the picker offers exactly the languages a catalog
 * exists for. Offering more would be a promise the build cannot keep: choosing one would leave the
 * whole interface in English with no way to tell why.
 *
 * `"system"` follows the language of the computer. It is the default, so a fresh install reads in
 * the user's language before anyone opens Settings, and an explicit choice is only the override.
 */
export interface AppLanguageOption {
  readonly id: AppLanguage;
  /**
   * The language's own name for itself, because a person looking for their language reads it in
   * that language and not in English.
   */
  readonly label: string;
  /**
   * The tag for the `lang` attribute on the row. It makes a screen reader speak the native name
   * with the correct voice. `"system"` has none: its label is in the interface language.
   */
  readonly lang?: string;
}

const LABELS: Record<AppLanguage, AppLanguageOption> = {
  system: { id: "system", label: "System default" },
  en: { id: "en", label: "English", lang: "en" },
  ja: { id: "ja", label: "日本語", lang: "ja" },
};

/**
 * System first, then the languages in the order of their own alphabet. English is not promoted
 * above the rest: it is one translation of the interface among the others.
 */
export const APP_LANGUAGE_OPTIONS: readonly AppLanguageOption[] = APP_LANGUAGES.map((id) => LABELS[id]);

/**
 * The option for a saved identifier, or the system row when the saved setting names a language this
 * build no longer ships. A removed translation must not leave the selector blank.
 */
export function appLanguageOption(id: AppLanguage): AppLanguageOption {
  return LABELS[id] ?? LABELS.system;
}

export type { AppLanguage };
