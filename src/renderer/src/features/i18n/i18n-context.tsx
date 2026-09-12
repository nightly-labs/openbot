import type { TOptions } from "i18next";
import { createContext, createSignal, type ParentProps, useContext } from "solid-js";
import i18n from "./i18n";

const [currentLanguage, setCurrentLanguage] = createSignal(i18n.language);

i18n.on("languageChanged", (lng) => {
  setCurrentLanguage(lng);
});

export const I18nContext = createContext({
  t: (key: string, options?: TOptions) => {
    currentLanguage(); // Rejestruje zależność reaktywną dla Solid.js!
    return i18n.t(key, options);
  },
  language: currentLanguage,
  changeLanguage: (lng: string) => i18n.changeLanguage(lng),
});

export function I18nProvider(props: ParentProps) {
  const value = {
    t: (key: string, options?: TOptions) => {
      currentLanguage(); // Rejestruje zależność reaktywną dla Solid.js!
      return i18n.t(key, options);
    },
    language: currentLanguage,
    changeLanguage: (lng: string) => i18n.changeLanguage(lng),
  };

  return <I18nContext value={value}>{props.children}</I18nContext>;
}

export function useI18n() {
  return useContext(I18nContext);
}
