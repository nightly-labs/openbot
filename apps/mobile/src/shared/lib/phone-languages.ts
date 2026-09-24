import { requireOptionalNativeModule } from "expo";
import type { Locale } from "expo-localization";

// Loaded like the speech module: the package entry requires the native module
// and would crash a build without it on import.
const localization = requireOptionalNativeModule<{ getLocales(): Locale[] }>("ExpoLocalization");

/** The phone's languages in the user's order, such as `["pl-PL", "en-US"]`. Empty when unknown. */
export function phoneLanguages(): string[] {
  try {
    return localization?.getLocales().map((locale) => locale.languageTag) ?? [];
  } catch {
    return [];
  }
}
