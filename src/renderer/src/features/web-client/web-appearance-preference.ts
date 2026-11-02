import { type AppAppearance, DEFAULT_APP_APPEARANCE, isAppAppearance } from "@openbot/contracts/app-appearance";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { syncColorScheme } from "../../color-scheme";
import { WEB_APPEARANCE_STORAGE_KEY as STORAGE_KEY } from "./web-appearance-boot";

type AppearanceStorage = Pick<Storage, "getItem" | "setItem">;

/** Reading `window.localStorage` throws when the browser blocks storage, so it is read inside the guard. */
function read(storage: AppearanceStorage | undefined): AppAppearance {
  try {
    const value = (storage ?? window.localStorage).getItem(STORAGE_KEY);
    return isAppAppearance(value) ? value : DEFAULT_APP_APPEARANCE;
  } catch {
    return DEFAULT_APP_APPEARANCE;
  }
}

/**
 * Shows the saved theme on the loading screen, before the code of the web client loads. Returns the
 * function that stops it, so the public pages are dark again after the user leaves `/app`.
 */
export function showSavedAppearance(): () => void {
  return syncColorScheme(() => read(undefined)).stop;
}

/**
 * The web client's light, dark or system theme. The web client has no main process, so this browser
 * keeps it, also before sign-in, and resolves "system" from the browser. Other tabs follow through
 * `storage`.
 */
export function createWebAppearancePreference(storage?: AppearanceStorage) {
  const [appearance, setStoredAppearance] = createSignal<AppAppearance>(read(storage));
  const scheme = syncColorScheme(appearance);
  createEffect(appearance, () => scheme.refresh());
  function listen(event: StorageEvent): void {
    // `localStorage.clear()` in another tab sends no key.
    if (event.key === STORAGE_KEY || event.key === null) setStoredAppearance(read(storage));
  }
  window.addEventListener("storage", listen);
  onCleanup(() => {
    window.removeEventListener("storage", listen);
    scheme.stop();
  });

  return {
    appearance,
    setAppearance(value: AppAppearance): void {
      setStoredAppearance(value);
      try {
        (storage ?? window.localStorage).setItem(STORAGE_KEY, value);
      } catch {
        // The choice holds for this tab when browser storage is unavailable.
      }
    },
  };
}
