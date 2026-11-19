import { type AppLanguage, DEFAULT_APP_LANGUAGE, isAppLanguage } from "@openbot/contracts/app-language";
import { loadLocale, resolveLocale } from "@openbot/i18n";
import { createSignal, onCleanup } from "solid-js";

const STORAGE_KEY = "openbot.web.language";

type LanguageStorage = Pick<Storage, "getItem" | "setItem">;

function read(storage: LanguageStorage | undefined): AppLanguage {
  try {
    const value = (storage ?? window.localStorage).getItem(STORAGE_KEY);
    return isAppLanguage(value) ? value : DEFAULT_APP_LANGUAGE;
  } catch {
    return DEFAULT_APP_LANGUAGE;
  }
}

export function loadSavedLanguage(): Promise<void> {
  return loadLocale(resolveLocale(read(undefined), navigator.language));
}

export function createWebLanguagePreference(storage?: LanguageStorage) {
  const [language, setStoredLanguage] = createSignal<AppLanguage>(read(storage));
  function listen(event: StorageEvent): void {
    if (event.key === STORAGE_KEY) setStoredLanguage(read(storage));
  }
  window.addEventListener("storage", listen);
  onCleanup(() => window.removeEventListener("storage", listen));

  return {
    language,
    setLanguage(value: AppLanguage): void {
      setStoredLanguage(value);
      try {
        (storage ?? window.localStorage).setItem(STORAGE_KEY, value);
      } catch {}
    },
  };
}
