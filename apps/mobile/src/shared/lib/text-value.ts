import {
  type AppFormat,
  createFormat,
  localizeSourceText,
  type MobileTranslate,
  mobileTranslateFor,
  type TranslatedLocale,
} from "@openbot/i18n/mobile";
import { userErrorMessage } from "@openbot/user-errors";

/**
 * The interface language on mobile. Screens call `useText()`; a store, an `Alert.alert` callback or
 * other code outside React calls `currentText()`, which reads the same state at the moment it runs.
 */
export interface MobileText {
  locale: TranslatedLocale;
  t: MobileTranslate;
  format: AppFormat;
  /** `userErrorMessage` in the interface language. `fallback` is already translated. */
  errorMessage: (error: unknown, fallback: string) => string;
  /** Text a host sent as English source text, in the interface language. */
  sourceText: (text: string) => string;
}

/**
 * Loads no native module, so tests can build the text for a fixed locale. `numbers` is the locale
 * of numbers and dates (`formatLocale`); the default is `locale`.
 */
export function textFor(locale: TranslatedLocale, numbers: string = locale): MobileText {
  return {
    locale,
    t: mobileTranslateFor(locale),
    format: createFormat(locale, numbers),
    errorMessage: (error, fallback) => userErrorMessage(error, fallback, locale),
    sourceText: (text) => localizeSourceText(text, locale),
  };
}
