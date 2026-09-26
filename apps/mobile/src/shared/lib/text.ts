import {
  type AppFormat,
  createFormat,
  localizeSourceText,
  type MobileTranslate,
  mobileTranslateFor,
  resolveLocale,
  type TranslatedLocale,
} from "@openbot/i18n/mobile";
import { userErrorMessage } from "@openbot/user-errors";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { useAppLanguage } from "@/features/settings/model/app-language";
import { phoneLanguages } from "./phone-languages";

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

function textFor(locale: TranslatedLocale): MobileText {
  return {
    locale,
    t: mobileTranslateFor(locale),
    format: createFormat(locale),
    errorMessage: (error, fallback) => userErrorMessage(error, fallback, locale),
    sourceText: (text) => localizeSourceText(text, locale),
  };
}

function phoneLocale(): string {
  return phoneLanguages()[0] ?? "en";
}

export function currentText(): MobileText {
  return textFor(resolveLocale(useAppLanguage.getState().value, phoneLocale()));
}

export function useText(): MobileText {
  const language = useAppLanguage((state) => state.value);
  // The phone's language can change in iOS Settings while OpenBot is in the background, so it is
  // read again each time the app becomes active.
  const [systemLocale, setSystemLocale] = useState(phoneLocale);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setSystemLocale(phoneLocale());
    });
    return () => subscription.remove();
  }, []);
  const locale = resolveLocale(language, systemLocale);
  return useMemo(() => textFor(locale), [locale]);
}
