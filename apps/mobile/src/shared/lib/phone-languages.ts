import { requireOptionalNativeModule } from "expo";
import type { Locale } from "expo-localization";

const localization = requireOptionalNativeModule<{ getLocales(): Locale[] }>("ExpoLocalization");

export function phoneLanguages(): string[] {
  try {
    return localization?.getLocales().map((locale) => locale.languageTag) ?? [];
  } catch {
    return [];
  }
}
