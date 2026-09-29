import { type AppLanguage, DEFAULT_APP_LANGUAGE, isAppLanguage } from "@openbot/contracts/app-language";
import { createSignal, onCleanup } from "solid-js";

const STORAGE_KEY = "openbot.web.language";

type LanguageStorage = Pick<Storage, "getItem" | "setItem">;

function read(storage: LanguageStorage): AppLanguage {
  try {
    const value = storage.getItem(STORAGE_KEY);
    return isAppLanguage(value) ? value : DEFAULT_APP_LANGUAGE;
  } catch {
    return DEFAULT_APP_LANGUAGE;
  }
}

/**
 * The web client's interface language. The web client has no main process, so this browser keeps it,
 * also before sign-in. Other tabs follow through `storage`.
 */
export function createWebLanguagePreference(storage: LanguageStorage = window.localStorage) {
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
        storage.setItem(STORAGE_KEY, value);
      } catch {
        // The choice holds for this tab when browser storage is unavailable.
      }
    },
  };
}
