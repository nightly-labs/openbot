import { formatLocale, resolveLocale } from "@openbot/i18n/mobile";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { useAppLanguage } from "@/features/settings/model/app-language";
import { phoneLanguages } from "./phone-languages";
import { type MobileText, textFor } from "./text-value";

export type { MobileText } from "./text-value";

function phoneLocale(): string {
  return phoneLanguages()[0] ?? "en";
}

export function currentText(): MobileText {
  const language = useAppLanguage.getState().value;
  const systemLocale = phoneLocale();
  return textFor(resolveLocale(language, systemLocale), formatLocale(language, systemLocale));
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
  const numbers = formatLocale(language, systemLocale);
  return useMemo(() => textFor(locale, numbers), [locale, numbers]);
}
