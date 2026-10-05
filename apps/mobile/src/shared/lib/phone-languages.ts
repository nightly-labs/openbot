import { requireOptionalNativeModule } from "expo";
import type { Locale } from "expo-localization";

// Loaded like the speech module: the package entry requires the native module
// and would crash a build without it on import.
const localization = requireOptionalNativeModule<{ getLocales(): Locale[] }>("ExpoLocalization");

/** The currency and region of the phone's first locale, such as `PLN` and `PL`. Null when unknown. */
export function phoneCurrencyAndRegion(): { currency: string | null; region: string | null } {
  try {
    const locale = localization?.getLocales()[0];
    return { currency: locale?.currencyCode ?? null, region: locale?.regionCode ?? null };
  } catch {
    return { currency: null, region: null };
  }
}

/** The phone's languages in the user's order, such as `["pl-PL", "en-US"]`. Empty when unknown. */
export function phoneLanguages(): string[] {
  try {
    return localization?.getLocales().map((locale) => locale.languageTag) ?? [];
  } catch {
    return [];
  }
}
