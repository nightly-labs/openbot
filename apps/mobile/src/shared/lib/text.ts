import { formatLocale, resolveLocale, type TranslatedLocale } from "@openbot/i18n/mobile";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useAppLanguage } from "@/features/settings/model/app-language";
import { phoneLanguages } from "./phone-languages";
import { type MobileText, textFor } from "./text-value";

export type { MobileText } from "./text-value";

function phoneLocale(): string {
  return phoneLanguages()[0] ?? "en";
}

let systemLocale: string | null = null;
const systemLocaleListeners = new Set<() => void>();

function systemLocaleNow(): string {
  if (systemLocale === null) {
    systemLocale = phoneLocale();
    AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const next = phoneLocale();
      if (next === systemLocale) return;
      systemLocale = next;
      for (const notify of systemLocaleListeners) notify();
    });
  }
  return systemLocale;
}

function subscribeSystemLocale(listener: () => void) {
  systemLocaleListeners.add(listener);
  return () => {
    systemLocaleListeners.delete(listener);
  };
}

const texts = new Map<string, MobileText>();

function sharedText(locale: TranslatedLocale, numbers: string): MobileText {
  const key = `${locale}\u0000${numbers}`;
  const cached = texts.get(key);
  if (cached) return cached;
  const text = textFor(locale, numbers);
  texts.set(key, text);
  return text;
}

export function currentText(): MobileText {
  const language = useAppLanguage.getState().value;
  const locale = systemLocaleNow();
  return sharedText(resolveLocale(language, locale), formatLocale(language, locale));
}

export function currentLocale(): TranslatedLocale {
  return resolveLocale(useAppLanguage.getState().value, systemLocaleNow());
}

export function useText(): MobileText {
  const language = useAppLanguage((state) => state.value);
  const locale = useSyncExternalStore(subscribeSystemLocale, systemLocaleNow);
  return sharedText(resolveLocale(language, locale), formatLocale(language, locale));
}
