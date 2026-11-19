import {
  type AppFormat,
  createFormat,
  localizeSourceText,
  type MobileTranslate,
  mobileTranslateFor,
  type TranslatedLocale,
} from "@openbot/i18n/mobile";
import { type UserErrorDetails, userErrorDetails, userErrorMessage } from "@openbot/user-errors";

export interface MobileText {
  locale: TranslatedLocale;
  t: MobileTranslate;
  format: AppFormat;
  errorMessage: (error: unknown, fallback: string) => string;
  errorDetails: (error: unknown, fallback: string) => UserErrorDetails;
  sourceText: (text: string) => string;
}

export function textFor(locale: TranslatedLocale, numbers: string = locale): MobileText {
  return {
    locale,
    t: mobileTranslateFor(locale),
    format: createFormat(locale, numbers),
    errorMessage: (error, fallback) => userErrorMessage(error, fallback, locale),
    errorDetails: (error, fallback) => userErrorDetails(error, fallback, locale),
    sourceText: (text) => localizeSourceText(text, locale),
  };
}
